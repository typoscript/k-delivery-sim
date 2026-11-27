import { ScooterState } from '../ScooterPhysics';
import { SCOOTER_MODELS } from '../ScooterModels';

/** Handlebar instrument cluster: speed, model badge / damage, fuel or battery % and a 10-segment gauge */
export function drawDashboardCluster(ctx: CanvasRenderingContext2D, w: number, h: number, state: ScooterState, elapsedTime: number): void {
  const spec = SCOOTER_MODELS[state.modelId];

  ctx.fillStyle = spec.isElectric ? '#051520' : '#090f1a';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = state.lowFuelWarning ? '#ef4444' : spec.isElectric ? '#06b6d4' : '#1e3a5f';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  // Top row: Speed + Model Badge + Fuel/Battery %
  const kmh = Math.round(Math.abs(state.speed) * 3.6);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${String(kmh).padStart(2, '0')}`, 14, 28);

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('km/h', 56, 33);

  if (state.damageLevel > 0) {
    ctx.fillStyle = '#fb923c';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🔧 -${state.damageLevel * 10}%`, w * 0.54, 28);
  } else {
    ctx.fillStyle = spec.isElectric ? '#22d3ee' : state.modelId === 'cub' ? '#fde68a' : '#94a3b8';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spec.shortBadge, w * 0.54, 28);
  }

  const fuelPct = Math.round(state.fuel);
  const lowBlink = state.lowFuelWarning && Math.floor(elapsedTime * 4) % 2 === 0;
  ctx.fillStyle =
    state.outOfFuel || lowBlink
      ? '#ef4444'
      : state.lowFuelWarning
        ? '#fca5a5'
        : spec.isElectric
          ? '#22d3ee'
          : '#34d399';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'right';
  const energyIcon = spec.isElectric ? '⚡' : '⛽';
  ctx.fillText(state.outOfFuel ? 'EMPTY!' : `${energyIcon}${fuelPct}%`, w - 12, 28);

  // Bottom row: 10-segment 3D Fuel/Battery Bar Gauge (E [||||||||..] F)
  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('E', 14, 68);
  ctx.fillStyle = spec.isElectric ? '#22d3ee' : '#38bdf8';
  ctx.textAlign = 'right';
  ctx.fillText('F', w - 14, 68);

  const segs = 10;
  const barX = 34;
  const barW = w - 68;
  const segW = (barW - (segs - 1) * 4) / segs;
  const filled = Math.ceil((state.fuel / 100) * segs);

  for (let i = 0; i < segs; i++) {
    const sx = barX + i * (segW + 4);
    const active = i < filled && state.fuel > 0.01;
    if (active) {
      ctx.fillStyle =
        state.lowFuelWarning
          ? lowBlink
            ? '#ef4444'
            : '#7f1d1d'
          : i < 2
            ? '#f59e0b'
            : spec.isElectric
              ? '#06b6d4'
              : '#22c55e';
    } else {
      ctx.fillStyle = '#1e293b';
    }
    ctx.fillRect(sx, 54, segW, 24);
  }

}
