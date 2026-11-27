/** Phone map route and self markers: bundle preview, navigation route, numbered stops, scooter pin, GPS arrow */
import type { MapFrame } from './mapFrame';

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

  // 6. Numbered Bundled Stop Markers (1, 2, 3...)
  if (!player.inCorridor) {
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
