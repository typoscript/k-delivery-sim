import { clamp } from '../types';

interface VisorDrop {
  x: number; // normalized 0..1 across screen width
  y: number; // normalized 0..1 across screen height
  r: number; // radius in px
  vy: number; // downward slide speed (normalized/s)
  vx: number; // slight wind drift
  alpha: number;
  trailLen: number;
}

/**
 * 1st-Person Helmet Visor Raindrop & Gloved-Hand Wiper Overlay:
 * - Accumulates realistic translucent refractive raindrops on the helmet visor while outdoors in rain
 * - Press [G] to sweep the rider's gloved hand across the visor, clearing droplets in its path!
 * - Immediately hidden when inside underground corridors or in dry weather.
 */
export class VisorRainOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly wipeHandEl: HTMLElement;
  private readonly drops: VisorDrop[] = [];

  private width = window.innerWidth;
  private height = window.innerHeight;
  private spawnAccum = 0;

  // Hand wipe sweep animation (0 -> 1 over 0.48s)
  private wiping = false;
  private wipeProgress = 0;
  private wipeDir = 1; // +1 left->right, -1 right->left

  public dropletDensity = 0; // 0..1 (used by HUD to suggest pressing [G])

  constructor() {
    this.canvas = document.getElementById('visor-rain-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.wipeHandEl = document.getElementById('visor-wipe-hand')!;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Triggers 1st-person gloved hand sweep across helmet visor ([G] key) */
  public triggerWipe(): boolean {
    if (this.wiping) return false;
    this.wiping = true;
    this.wipeProgress = 0;
    this.wipeDir = this.wipeDir > 0 ? -1 : 1;
    this.wipeHandEl.classList.remove('hidden');
    return true;
  }

  public clearImmediately(): void {
    this.drops.length = 0;
    this.dropletDensity = 0;
    this.wiping = false;
    this.wipeHandEl.classList.add('hidden');
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  public update(
    dt: number,
    rainIntensity: number,
    inCorridor: boolean,
    scooterSpeedMps: number,
    isRiding: boolean
  ): void {
    const clampedDt = Math.min(dt, 0.05);

    if (inCorridor) {
      if (this.drops.length > 0 || this.wiping) {
        this.clearImmediately();
      }
      return;
    }

    // 1. Spawn new droplets when raining outdoors (faster accumulation at higher riding speed!)
    if (rainIntensity > 0.05) {
      const speedBoost = isRiding ? 1 + clamp(Math.abs(scooterSpeedMps) / 14, 0, 1.35) : 0.7;
      const maxDrops = 78;
      this.spawnAccum += clampedDt * rainIntensity * 22 * speedBoost;
      while (this.spawnAccum >= 1 && this.drops.length < maxDrops) {
        this.spawnAccum -= 1;
        this.drops.push({
          x: 0.04 + Math.random() * 0.92,
          y: 0.03 + Math.random() * 0.88,
          r: 2.6 + Math.random() * 5.8,
          vy: 0.012 + Math.random() * 0.048,
          vx: (Math.random() - 0.5) * 0.012,
          alpha: 0.42 + Math.random() * 0.36,
          trailLen: 4 + Math.random() * 14,
        });
      }
    } else {
      // Dry weather -> gently evaporate remaining droplets
      for (const d of this.drops) {
        d.alpha -= clampedDt * 0.55;
      }
    }

    // 2. Advance hand wiper sweep & remove droplets inside swept band!
    if (this.wiping) {
      this.wipeProgress += clampedDt / 0.46;
      const p = clamp(this.wipeProgress, 0, 1);
      // Smooth ease-in-out sweep position across viewport X (0..1)
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const sweepX = this.wipeDir > 0 ? -0.12 + ease * 1.24 : 1.12 - ease * 1.24;
      const arcY = 0.56 - Math.sin(ease * Math.PI) * 0.14;
      const rotDeg = this.wipeDir > 0 ? -24 + ease * 48 : 24 - ease * 48;

      this.wipeHandEl.style.transform = `translate3d(${sweepX * this.width - 90}px, ${arcY * this.height - 120}px, 0) rotate(${rotDeg}deg) scaleX(${this.wipeDir > 0 ? 1 : -1})`;

      // Wipe out droplets crossed by the gloved thumb/blade
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const dx = this.drops[i].x - sweepX;
        if (Math.abs(dx) < 0.16) {
          this.drops.splice(i, 1);
        }
      }

      if (this.wipeProgress >= 1) {
        this.wiping = false;
        this.wipeHandEl.classList.add('hidden');
      }
    }

    // 3. Step droplet gravity & wind streaming
    const windMul = isRiding ? 1 + clamp(Math.abs(scooterSpeedMps) / 10, 0, 2.2) : 1;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y += d.vy * windMul * clampedDt;
      d.x += d.vx * clampedDt;
      if (d.y > 1.05 || d.alpha <= 0.02) {
        this.drops.splice(i, 1);
      }
    }

    this.dropletDensity = clamp(this.drops.length / 64, 0, 1);

    // 4. Render crisp visor droplets + subtle wet visor edge vignette
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.drops.length === 0 && rainIntensity < 0.05) return;

    if (rainIntensity > 0.08 && this.dropletDensity > 0.08) {
      // Subtle translucent edge condensation along outer helmet visor rim
      const vig = ctx.createRadialGradient(
        this.width * 0.5,
        this.height * 0.5,
        Math.min(this.width, this.height) * 0.34,
        this.width * 0.5,
        this.height * 0.5,
        Math.max(this.width, this.height) * 0.65
      );
      vig.addColorStop(0, 'rgba(186, 230, 253, 0)');
      vig.addColorStop(1, `rgba(148, 197, 235, ${0.14 * this.dropletDensity * rainIntensity})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    for (const d of this.drops) {
      const px = d.x * this.width;
      const py = d.y * this.height;
      const rx = d.r;
      const ry = d.r * 1.24;

      // Faint trailing water streak above sliding drop
      ctx.strokeStyle = `rgba(219, 234, 254, ${d.alpha * 0.25})`;
      ctx.lineWidth = Math.max(1, rx * 0.42);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py - ry);
      ctx.lineTo(px - d.vx * 60, py - ry - d.trailLen);
      ctx.stroke();

      // Refractive droplet body
      const grad = ctx.createRadialGradient(
        px - rx * 0.28,
        py - ry * 0.3,
        rx * 0.1,
        px,
        py,
        ry
      );
      grad.addColorStop(0, `rgba(255, 255, 255, ${d.alpha * 0.85})`);
      grad.addColorStop(0.55, `rgba(186, 230, 253, ${d.alpha * 0.26})`);
      grad.addColorStop(1, `rgba(30, 58, 138, ${d.alpha * 0.34})`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Specular rim catchlight
      ctx.strokeStyle = `rgba(255, 255, 255, ${d.alpha * 0.52})`;
      ctx.lineWidth = 0.85;
      ctx.stroke();
    }
  }
}
