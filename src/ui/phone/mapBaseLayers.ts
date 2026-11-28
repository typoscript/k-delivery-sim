/** Phone map base layers: parks / water / plazas, roads, buildings and landmark pins */
import type { MapFrame } from './mapFrame';
import { clamp } from '../../types';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';

/** Parks, water bodies and pedestrian plazas */
export function drawAreaOverlays(f: MapFrame): void {
  const { ctx, isNight, mapInfo, theme, scale, toX, toY, ptsInView } = f;
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
}

/** Road network: outlines, fills and the yellow centre lines of major roads */
export function drawRoads(f: MapFrame): void {
  const { ctx, theme, effectiveZoom, scale, toX, toY, inView } = f;
  // 2. Real Suwon Ingye-dong OSM Road Network (218 segments!)
  const osmNodes = ACTIVE_MAP_DATA.nodes;
  const osmEdges = ACTIVE_MAP_DATA.edges.filter((e) => {
    const na = osmNodes[e.a];
    const nb = osmNodes[e.b];
    return inView(Math.min(na.x, nb.x), Math.max(na.x, nb.x), Math.min(na.z, nb.z), Math.max(na.z, nb.z));
  });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Bridges: a wide dark deck band under the road (OSM bridge tags)
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.95)';
  for (const e of osmEdges) {
    if (!e.bridge) continue;
    const na = osmNodes[e.a];
    const nb = osmNodes[e.b];
    ctx.lineWidth = Math.max(4, e.width * scale + 6);
    ctx.beginPath();
    ctx.moveTo(toX(na.x), toY(na.z));
    ctx.lineTo(toX(nb.x), toY(nb.z));
    ctx.stroke();
  }

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

  // Underpasses (지하차도): dashed grey cover over the road (OSM tunnel tags)
  for (const e of osmEdges) {
    if (!e.tunnel) continue;
    const na = osmNodes[e.a];
    const nb = osmNodes[e.b];
    ctx.save();
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.55)';
    ctx.lineWidth = Math.max(2, e.width * scale);
    ctx.setLineDash([3 * effectiveZoom, 3 * effectiveZoom]);
    ctx.beginPath();
    ctx.moveTo(toX(na.x), toY(na.z));
    ctx.lineTo(toX(nb.x), toY(nb.z));
    ctx.stroke();
    ctx.restore();
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
}

/** Building footprints and the district landmark pins */
export function drawBuildingsAndLandmarks(f: MapFrame): void {
  const { ctx, player, isNight, mapInfo, rotateHeadingUp, theme, effectiveZoom, scale, toX, toY, inView } = f;
  // 3. Real Suwon Building Polygon Footprints (322 OSM buildings!)
  for (const b of mapInfo.buildings) {
    if (!inView(b.x - b.w, b.x + b.w, b.z - b.d, b.z + b.d)) continue;
    ctx.fillStyle = b.kind === 'shop' ? theme.bldgShop : b.kind === 'residential' ? theme.bldgRes : theme.bldgPublic;
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
}
