import { PlayerState } from '../../player/PlayerController';
import { ScooterState } from '../../vehicle/ScooterPhysics';
import { CityMapInfo } from '../../world/CityWorld';
import { NavigationPlan } from '../../delivery/DeliveryManager';
import { SignalStateSnapshot } from '../../world/TrafficSystem';
import { clamp } from '../../types';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { MapViewState } from './mapView';

/** Draws the full 2D GPS city map (north-up when zoomed, heading-up when riding) onto a canvas context */
export function renderMapToContext(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  view: MapViewState,
  player: PlayerState,
  scooter: ScooterState,
  navPlan: NavigationPlan,
  signalState: SignalStateSnapshot,
  isNight: boolean,
  elapsedTime: number,
  mapInfo: CityMapInfo,
  rotateHeadingUp: boolean
): void {
  if (w < 10 || h < 10) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  const theme = isNight
    ? {
        bg: '#111827',
        block: '#1b2534',
        park: '#173429',
        water: '#164e63',
        roadOutline: '#2a374b',
        roadFill: '#243041',
        roadCenter: 'rgba(250, 204, 21, 0.5)',
        bldgShop: '#33292a',
        bldgRes: '#233042',
        bldgPublic: '#283244',
        bldgStroke: 'rgba(148, 163, 184, 0.25)',
        labelText: '#e2e8f0',
      }
    : {
        bg: '#e5e9ef',
        block: '#eef1f5',
        park: '#cdebd2',
        water: '#7dd3fc',
        roadOutline: '#cbd5e1',
        roadFill: '#ffffff',
        roadCenter: 'rgba(234, 179, 8, 0.65)',
        bldgShop: '#fde6cc',
        bldgRes: '#dbeafe',
        bldgPublic: '#e2e8f0',
        bldgStroke: 'rgba(100, 116, 139, 0.35)',
        labelText: '#1e293b',
      };

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const effectiveZoom = rotateHeadingUp ? 1.85 : view.zoomLevel;
  const baseScale = Math.min(w, h) / 285;
  const scale = baseScale * effectiveZoom;
  const centerX = w * 0.5;
  const centerY = rotateHeadingUp ? h * 0.57 : h * 0.36;

  const viewCamX = rotateHeadingUp ? player.x : view.camX;
  const viewCamZ = rotateHeadingUp ? player.z : view.camZ;

  // Apply Heading-Up map rotation while riding in 3D Navigation Mode!
  ctx.save();
  ctx.translate(centerX, centerY);
  if (rotateHeadingUp) {
    ctx.rotate(player.heading);
  }

  const toX = (wx: number) => -(wx - viewCamX) * scale;
  const toY = (wz: number) => -(wz - viewCamZ) * scale;

  // Viewport culling (the unified city has 8,000+ road segments): anything whose bbox misses a square
  // around the camera that covers the whole canvas at any heading-up rotation is skipped
  const viewR = Math.hypot(w, h) / scale;
  const inView = (minX: number, maxX: number, minZ: number, maxZ: number) =>
    maxX >= viewCamX - viewR && minX <= viewCamX + viewR && maxZ >= viewCamZ - viewR && minZ <= viewCamZ + viewR;
  const ptsInView = (pts: ReadonlyArray<[number, number]>) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return inView(minX, maxX, minZ, maxZ);
  };
  // Unified open world: park / water / pedestrian-street overlays come from the streamed chunks
  const parks = mapInfo.areaParks ?? ACTIVE_MAP_DATA.parks;
  const waters = mapInfo.areaWaters ?? ACTIVE_MAP_DATA.waters ?? [];
  const plazas = mapInfo.areaPlazas ?? ACTIVE_MAP_DATA.pedestrianPlazas;

  // 1. Real Suwon Ingye-dong Parks (효원공원 etc.)
  for (const park of parks) {
    if (park.pts.length < 3 || !ptsInView(park.pts)) continue;
    ctx.fillStyle = theme.park;
    ctx.beginPath();
    ctx.moveTo(toX(park.pts[0][0]), toY(park.pts[0][1]));
    for (let i = 1; i < park.pts.length; i++) {
      ctx.lineTo(toX(park.pts[i][0]), toY(park.pts[i][1]));
    }
    ctx.closePath();
    ctx.fill();
  }

  // 1.2. Real OSM Water Bodies (광교 원천호수 등)
  if (waters.length > 0) {
    for (const wt of waters) {
      if (wt.pts.length < 3 || !ptsInView(wt.pts)) continue;
      ctx.fillStyle = theme.water;
      ctx.beginPath();
      ctx.moveTo(toX(wt.pts[0][0]), toY(wt.pts[0][1]));
      for (let i = 1; i < wt.pts.length; i++) {
        ctx.lineTo(toX(wt.pts[i][0]), toY(wt.pts[i][1]));
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // 1.5. Pedestrian Plazas (나혜석거리)
  ctx.lineCap = 'round';
  ctx.strokeStyle = isNight ? '#3d332a' : '#e9d8c8';
  for (const pl of plazas) {
    if (pl.pts.length < 2 || !ptsInView(pl.pts)) continue;
    ctx.lineWidth = Math.max(2.5, pl.width * scale);
    ctx.beginPath();
    ctx.moveTo(toX(pl.pts[0][0]), toY(pl.pts[0][1]));
    for (let i = 1; i < pl.pts.length; i++) {
      ctx.lineTo(toX(pl.pts[i][0]), toY(pl.pts[i][1]));
    }
    ctx.stroke();
  }

  // 2. Real Suwon Ingye-dong OSM Road Network (218 segments!)
  const osmNodes = ACTIVE_MAP_DATA.nodes;
  const osmEdges = ACTIVE_MAP_DATA.edges.filter((e) => {
    const na = osmNodes[e.a];
    const nb = osmNodes[e.b];
    return inView(Math.min(na.x, nb.x), Math.max(na.x, nb.x), Math.min(na.z, nb.z), Math.max(na.z, nb.z));
  });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Road outlines
  ctx.strokeStyle = theme.roadOutline;
  for (const e of osmEdges) {
    const na = osmNodes[e.a];
    const nb = osmNodes[e.b];
    ctx.lineWidth = Math.max(2.5, e.width * scale + 2.0);
    ctx.beginPath();
    ctx.moveTo(toX(na.x), toY(na.z));
    ctx.lineTo(toX(nb.x), toY(nb.z));
    ctx.stroke();
  }

  // Road fills
  ctx.strokeStyle = theme.roadFill;
  for (const e of osmEdges) {
    const na = osmNodes[e.a];
    const nb = osmNodes[e.b];
    ctx.lineWidth = Math.max(1.8, e.width * scale);
    ctx.beginPath();
    ctx.moveTo(toX(na.x), toY(na.z));
    ctx.lineTo(toX(nb.x), toY(nb.z));
    ctx.stroke();
  }

  // Yellow center lines on major Suwon boulevards (효원로, 권광로, 경수대로, 권선로)
  ctx.save();
  ctx.strokeStyle = theme.roadCenter;
  ctx.lineWidth = Math.max(1, 1.0 * effectiveZoom);
  ctx.setLineDash([4 * effectiveZoom, 5 * effectiveZoom]);
  ctx.beginPath();
  for (const e of osmEdges) {
    if (!e.isMajor) continue;
    const na = osmNodes[e.a];
    const nb = osmNodes[e.b];
    ctx.moveTo(toX(na.x), toY(na.z));
    ctx.lineTo(toX(nb.x), toY(nb.z));
  }
  ctx.stroke();
  ctx.restore();

  // 3. Real Suwon Building Polygon Footprints (322 OSM buildings!)
  for (const b of mapInfo.buildings) {
    if (!inView(b.x - b.w, b.x + b.w, b.z - b.d, b.z + b.d)) continue;
    ctx.fillStyle =
      b.kind === 'shop'
        ? theme.bldgShop
        : b.kind === 'residential'
          ? theme.bldgRes
          : theme.bldgPublic;
    ctx.strokeStyle = theme.bldgStroke;
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    if (b.pts && b.pts.length >= 3) {
      ctx.moveTo(toX(b.pts[0][0]), toY(b.pts[0][1]));
      for (let i = 1; i < b.pts.length; i++) {
        ctx.lineTo(toX(b.pts[i][0]), toY(b.pts[i][1]));
      }
      ctx.closePath();
    } else {
      const rw = b.w * scale;
      const rd = b.d * scale;
      ctx.roundRect(toX(b.x) - rw / 2, toY(b.z) - rd / 2, rw, rd, 2);
    }
    ctx.fill();
    ctx.stroke();

    if (b.label && !rotateHeadingUp && effectiveZoom >= 1.1 && b.w * scale > 10) {
      ctx.font = `700 ${Math.round(clamp(9.5 * Math.sqrt(effectiveZoom), 9, 12))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.labelText;
      ctx.fillText(b.label, toX(b.x), toY(b.z));
    }
  }

  // 3.2. Suwon Signature Landmark Pins (팔달문·화성행궁·통닭거리 / 수원시청역·나혜석거리·효원공원 / 수원역·로데오거리)
  if (mapInfo.landmarks && mapInfo.landmarks.length > 0) {
    for (const lm of mapInfo.landmarks) {
      const lx = toX(lm.x);
      const ly = toY(lm.z);
      ctx.fillStyle = lm.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.arc(lx, ly, 8.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(lx, ly);
      if (rotateHeadingUp) ctx.rotate(-player.heading);
      ctx.font = 'bold 9.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lm.icon, 0, 0.5);

      if (!rotateHeadingUp && effectiveZoom >= 0.85) {
        ctx.font = '800 9.5px sans-serif';
        const tw = ctx.measureText(lm.shortLabel).width + 8;
        ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.86)' : 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.roundRect(-tw / 2, 10, tw, 13, 4);
        ctx.fill();
        ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
        ctx.fillText(lm.shortLabel, 0, 16.8);
      }
      ctx.restore();
    }
  } else {
    const st = ACTIVE_MAP_DATA.meta.station;
    const sx = toX(st.x);
    const sy = toY(st.z);
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.translate(sx, sy);
    if (rotateHeadingUp) ctx.rotate(-player.heading);
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.badgeChar ?? '역', 0, 0.5);
    ctx.restore();
  }

  // 3.5. Bus stop icons, Service Station pins (⛽ Gas / 🔧 Repair), & Intersection signal status dots
  for (const bs of mapInfo.busStops) {
    const bx = toX(bs.shelterX);
    const by = toY(bs.shelterZ);
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.roundRect(bx - 4, by - 4, 8, 8, 2);
    ctx.fill();
  }

  for (const st of mapInfo.serviceStations) {
    const stx = toX(st.interactX);
    const sty = toY(st.interactZ);
    ctx.fillStyle =
      st.kind === 'gas' ? '#eab308' : st.kind === 'convenience' ? '#10b981' : '#ea580c';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(stx - 8, sty - 8, 16, 16, 4);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.translate(stx, sty);
    if (rotateHeadingUp) ctx.rotate(-player.heading);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.kind === 'gas' ? '⛽' : st.kind === 'convenience' ? '🏪' : '🔧', 0, 0.5);
    ctx.restore();
  }

  // Fixed Speed / Red-Light Enforcement Camera Markers (📷50) on Smartphone GPS Map!
  if (mapInfo.speedCameras) {
    for (const cam of mapInfo.speedCameras) {
      const cx = toX(cam.x);
      const cy = toY(cam.z);
      ctx.fillStyle = '#dc2626';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      if (rotateHeadingUp) ctx.rotate(-player.heading);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cam.limitKmh), 0, 0.5);
      ctx.restore();
    }
  }

  // Live Korean Police Patrol Car Markers (🚓 with alternating red/blue strobe) on Smartphone GPS Map!
  if (mapInfo.policePatrols) {
    const strobe = Math.floor(elapsedTime * 5) % 2 === 0;
    for (const p of mapInfo.policePatrols) {
      const px2 = toX(p.x);
      const py2 = toY(p.z);
      ctx.fillStyle = strobe ? '#2563eb' : '#ef4444';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(px2, py2, p.sirenActive ? 9.5 : 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(px2, py2);
      if (rotateHeadingUp) ctx.rotate(-player.heading);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚓', 0, 0.5);
      ctx.restore();
    }
  }

  // 1-Lane Road Construction Zone Markers (🚧) on Smartphone GPS Map!
  if (mapInfo.constructionZones) {
    for (const cz of mapInfo.constructionZones) {
      const cx = toX(cz.x);
      const cy = toY(cz.z);
      ctx.fillStyle = '#f97316';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 6.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      if (rotateHeadingUp) ctx.rotate(-player.heading);
      ctx.font = 'bold 8.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚧', 0, 0.5);
      ctx.restore();
    }
  }

  // Rival AI Delivery Scooter Rider Dots on Smartphone GPS Map!
  if (mapInfo.rivalRiders) {
    for (const rr of mapInfo.rivalRiders) {
      const rx = toX(rr.x);
      const ry = toY(rr.z);
      ctx.fillStyle = rr.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(rx, ry, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  const sigHex = (c: 'green' | 'yellow' | 'red') =>
    c === 'green' ? '#22c55e' : c === 'yellow' ? '#facc15' : '#ef4444';

  for (const sn of ACTIVE_MAP_DATA.nodes) {
    if (!sn.isSignal || !inView(sn.x, sn.x, sn.z, sn.z)) continue;
    const mx = toX(sn.x);
    const my = toY(sn.z);
    ctx.fillStyle = sigHex(signalState.ns);
    ctx.beginPath();
    ctx.arc(mx, my - 2.6, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = sigHex(signalState.ew);
    ctx.beginPath();
    ctx.arc(mx + 2.6, my, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Secondary Bundled Stops Preview Dashed Line
  if (!player.inCorridor && navPlan.recommendedStops.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 2.6;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    for (let i = 0; i < navPlan.recommendedStops.length; i++) {
      const st = navPlan.recommendedStops[i];
      const sx = toX(st.x);
      const sy = toY(st.z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 5. Primary A* Fluorescent Neon-Green Navigation Polyline
  if (!player.inCorridor && navPlan.route.length >= 2) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer neon glow
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.38)';
    ctx.lineWidth = rotateHeadingUp ? 12 : 9.5;
    ctx.beginPath();
    ctx.moveTo(toX(navPlan.route[0].x), toY(navPlan.route[0].z));
    for (let i = 1; i < navPlan.route.length; i++) {
      ctx.lineTo(toX(navPlan.route[i].x), toY(navPlan.route[i].z));
    }
    ctx.stroke();

    // Core fluorescent green stroke
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = rotateHeadingUp ? 5.5 : 4.2;
    ctx.stroke();
    ctx.restore();
  }

  // 6. Numbered Bundled Stop Markers (1, 2, 3...)
  if (!player.inCorridor) {
    for (let i = navPlan.recommendedStops.length - 1; i >= 0; i--) {
      const st = navPlan.recommendedStops[i];
      const tx = toX(st.x);
      const ty = toY(st.z);
      const pinColor =
        st.kind === 'pickup' ? '#f97316' : st.kind === 'load_box' ? '#0284c7' : '#10b981';

      if (st.isCurrent) {
        const pulse = 11 + Math.sin(elapsedTime * 5) * 3.5;
        ctx.fillStyle =
          st.kind === 'pickup' ? 'rgba(249,115,22,0.34)' : 'rgba(57,255,20,0.34)';
        ctx.beginPath();
        ctx.arc(tx, ty, pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = pinColor;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(tx, ty, st.isCurrent ? 8.5 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Keep step number upright even when map is rotated!
      ctx.save();
      ctx.translate(tx, ty);
      if (rotateHeadingUp) ctx.rotate(-player.heading);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), 0, 0.5);
      ctx.restore();
    }
  }

  // 7. Own Scooter Pin
  const sx = toX(scooter.x);
  const sy = toY(scooter.z);
  if (player.mode !== 'riding') {
    ctx.save();
    ctx.strokeStyle = scooter.crashed ? 'rgba(239,68,68,0.65)' : 'rgba(20,184,166,0.6)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(toX(player.x), toY(player.z));
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = scooter.crashed ? '#ef4444' : '#0d9488';
    ctx.beginPath();
    ctx.arc(sx, sy, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 8. Player Live GPS Arrow
  const px = toX(player.x);
  const py = toY(player.z);
  const dirX = -Math.sin(player.heading);
  const dirY = -Math.cos(player.heading);
  const mapAngle = Math.atan2(dirY, dirX);

  const grad = ctx.createRadialGradient(px, py, 2, px, py, 28);
  grad.addColorStop(0, 'rgba(59, 130, 246, 0.45)');
  grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.arc(px, py, 28, mapAngle - 0.55, mapAngle + 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(mapAngle + Math.PI / 2);
  ctx.fillStyle = rotateHeadingUp ? '#38bdf8' : '#2563eb';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, rotateHeadingUp ? -11 : -8.5);
  ctx.lineTo(rotateHeadingUp ? 8 : 6.2, rotateHeadingUp ? 8.5 : 6.5);
  ctx.lineTo(0, rotateHeadingUp ? 4.5 : 3.5);
  ctx.lineTo(rotateHeadingUp ? -8 : -6.2, rotateHeadingUp ? 8.5 : 6.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.restore(); // undo translate/rotate
  ctx.restore(); // undo dpr scale
}
