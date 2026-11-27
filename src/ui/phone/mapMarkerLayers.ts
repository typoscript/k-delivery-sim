/** Phone map markers: bus stops, service stations, signals, speed cameras, construction zones, rival riders */
import type { MapFrame } from './mapFrame';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';

/** Bus stops, service stations, signal dots, speed cameras, construction zones and rival riders */
export function drawMapMarkers(f: MapFrame): void {
  const { ctx, player, signalState, mapInfo, rotateHeadingUp, toX, toY, inView } = f;
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
    ctx.fillStyle = st.kind === 'gas' ? '#eab308' : st.kind === 'convenience' ? '#10b981' : '#ea580c';
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
}
