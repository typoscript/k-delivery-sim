import { walkwayPath } from '../../world/streamPaths';
/** Phone map route and self markers: bundle preview, navigation route, numbered stops, scooter pin, GPS arrow */
import type { MapFrame } from './mapFrame';
import { NO_GROUND_PARK_LIMIT_M, isNoGroundVehicleComplex } from '../../delivery/apartmentRules';

/**
 * 지상 차량 출입 금지 단지 on the route: a red dashed ring of the no-parking radius around the lobby, so the rider
 * sees where to leave the scooter (outside the ring) to earn the walking allowance
 */
function drawNoGroundZones(f: MapFrame): void {
  const { ctx, player, navPlan, rotateHeadingUp, toX, toY } = f;
  for (const st of navPlan.recommendedStops) {
    if (st.kind !== 'dropoff' || !st.location || !isNoGroundVehicleComplex(st.location)) continue;
    const cx = toX(st.x);
    const cy = toY(st.z);
    const r = Math.hypot(toX(st.x + NO_GROUND_PARK_LIMIT_M) - cx, toY(st.z) - toY(st.z + 0)) || 1;
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    // badge on the ring's edge, kept upright on a rotating map
    ctx.translate(cx, cy);
    if (rotateHeadingUp) ctx.rotate(-player.heading);
    const by = -r - 8;
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.roundRect(-34, by - 7, 68, 14, 7);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.isCurrent ? '🚫 정문 밖 주차' : '🚫 지상 차량X', 0, by + 0.5);
    ctx.restore();
  }
}

/** Bundle preview line, the navigation route and the numbered stop markers */
export function drawRouteLayer(f: MapFrame): void {
  const { ctx, player, navPlan, elapsedTime, rotateHeadingUp, toX, toY } = f;
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

  // 5b. Bench delivery: the walk from where the route leaves the road, along the walkway to the bench (dashed)
  if (!player.inCorridor && navPlan.route.length >= 2 && navPlan.target?.residenceKind === 'riverside') {
    const r = navPlan.route;
    const walk = walkwayPath(f.mapInfo.areaStreams ?? [], r[r.length - 2], r[r.length - 1]);
    if (walk) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = rotateHeadingUp ? 5 : 4;
      ctx.beginPath();
      ctx.moveTo(toX(walk[0].x), toY(walk[0].z));
      for (let i = 1; i < walk.length; i++) ctx.lineTo(toX(walk[i].x), toY(walk[i].z));
      ctx.stroke();
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = rotateHeadingUp ? 3 : 2.4;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 6. Numbered Bundled Stop Markers (1, 2, 3...), no-vehicle complex rings under them
  if (!player.inCorridor) {
    drawNoGroundZones(f);
    for (let i = navPlan.recommendedStops.length - 1; i >= 0; i--) {
      const st = navPlan.recommendedStops[i];
      const tx = toX(st.x);
      const ty = toY(st.z);
      const pinColor = st.kind === 'pickup' ? '#f97316' : st.kind === 'load_box' ? '#0284c7' : '#10b981';

      if (st.isCurrent) {
        const pulse = 11 + Math.sin(elapsedTime * 5) * 3.5;
        ctx.fillStyle = st.kind === 'pickup' ? 'rgba(249,115,22,0.34)' : 'rgba(57,255,20,0.34)';
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
}

/** The parked scooter pin and the player's GPS arrow with its view cone */
export function drawSelfMarkers(f: MapFrame): void {
  const { ctx, player, scooter, rotateHeadingUp, toX, toY } = f;
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
}
