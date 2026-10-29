/**
 * Party-popper confetti physics and drawing for the order celebration. Pure canvas code with no
 * dependencies: launch bursts from popper mouths, then integrate gravity, air drag, flutter and
 * sideways drift each frame. All randomness, sizes and speeds scale with the viewport.
 *
 * Built to stay smooth on low-end phones: a "lite" tier fires fewer, simpler pieces, every piece is
 * drawn with one setTransform (no save/restore), and the particle list is compacted in place so
 * frames allocate nothing. The caller can also call degrade() mid-run if frames start to drop.
 */

export type Side = 'left' | 'right';

/** When each popper fires (seconds from start) and how many pieces it releases. */
export interface Burst {
  at: number;
  side: Side;
  /** Share of the full particle budget released by this burst. */
  share: number;
  /** 1 = full power; smaller follow-up bursts are gentler. */
  power: number;
}

export const BURSTS: Burst[] = [
  { at: 0.22, side: 'left', share: 0.2, power: 1 },
  { at: 0.22, side: 'right', share: 0.2, power: 1 },
  { at: 0.6, side: 'left', share: 0.13, power: 0.92 },
  { at: 0.78, side: 'right', share: 0.13, power: 0.92 },
  { at: 1.15, side: 'left', share: 0.09, power: 0.85 },
  { at: 1.15, side: 'right', share: 0.09, power: 0.85 },
  { at: 1.55, side: 'left', share: 0.08, power: 0.75 },
  { at: 1.72, side: 'right', share: 0.08, power: 0.75 },
];

/** Total run time in seconds; the engine always stops by then. */
export const DURATION = 6.2;
/** Particles start fading out here so nothing ends abruptly. */
const FADE_FROM = 4.7;

const PALETTE = ['#FFCA16', '#FFD84D', '#FFE38A', '#EF4444', '#3B82F6', '#22C55E', '#F97316', '#EC4899', '#8B5CF6', '#FFF7DB'];
const GOLD = '#D4A017';
const GOLD_SHINE = '#FFF1B8';

type Kind = 'paper' | 'square' | 'big' | 'streamer' | 'spiral' | 'spark' | 'flash';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Air drag (per second) and gravity multiplier: light paper floats, streamers sail. */
  drag: number;
  gravity: number;
  angle: number;
  spin: number;
  /** Phase of the 3D flip that makes paper catch the light as it tumbles. */
  flip: number;
  flipSpeed: number;
  /** Sideways flutter while falling. */
  wobble: number;
  wobbleSpeed: number;
  wobbleAmp: number;
  w: number;
  h: number;
  color: string;
  metallic: boolean;
  /** Darker shade shown while paper faces away, precomputed so drawing stays one fill. */
  back: string;
  age: number;
  life: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** The same colour about 22% darker, for the back face of a tumbling piece. */
const shade = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.78);
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};
const BACK = new Map([...PALETTE, GOLD].map((c) => [c, shade(c)]));
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

/** Where the confetti leaves each popper, in canvas pixels. */
export type Mouths = Record<Side, { x: number; y: number }>;

export class ConfettiEngine {
  private particles: Particle[] = [];
  private fired = new Set<number>();
  private elapsed = 0;
  private budget: number;
  /** Canvas pixels per CSS pixel; drawing sets the full transform itself. */
  private dpr = 1;

  constructor(
    private width: number,
    private height: number,
    private mouths: Mouths,
    /** Low-end tier: fewer pieces, no spirals or metallic ribbons, simpler sparks. */
    private lite = false
  ) {
    // Dense on large screens, lighter on phones and much lighter on low-end devices.
    const area = width * height;
    this.budget = lite
      ? Math.round(Math.min(260, Math.max(150, area / 4200)))
      : Math.round(Math.min(620, Math.max(360, area / 2300)));
  }

  resize(width: number, height: number, mouths: Mouths, dpr = this.dpr) {
    this.width = width;
    this.height = height;
    this.mouths = mouths;
    this.dpr = dpr;
  }

  get isLite() {
    return this.lite;
  }

  /** Frames are dropping: switch to the lite tier and drop about half of the pieces in flight. */
  degrade() {
    if (this.lite) return;
    this.lite = true;
    this.budget = Math.round(this.budget * 0.45);
    let keep = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (i % 2 === 0 && p.kind !== 'spiral') this.particles[keep++] = p;
    }
    this.particles.length = keep;
  }

  get time() {
    return this.elapsed;
  }

  /** True once everything has settled or the run time is over. */
  get done() {
    return this.elapsed >= DURATION || (this.elapsed > BURSTS[BURSTS.length - 1].at + 0.5 && this.particles.length === 0);
  }

  /** Bursts that fired during the last step, for syncing popper recoil. */
  step(dt: number): Burst[] {
    const fired: Burst[] = [];
    this.elapsed += dt;
    BURSTS.forEach((burst, index) => {
      if (!this.fired.has(index) && this.elapsed >= burst.at) {
        this.fired.add(index);
        this.fire(burst);
        fired.push(burst);
      }
    });

    const g = this.height * 0.62; // px/s² — tuned so pieces hang in the air before settling
    const bottom = this.height + 60;
    // Compact in place: no new array per frame, so no garbage-collection pauses mid-animation.
    let keep = 0;
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life || p.y > bottom) continue;
      const damping = Math.exp(-p.drag * dt);
      p.vx *= damping;
      p.vy = p.vy * damping + g * p.gravity * dt;
      p.wobble += p.wobbleSpeed * dt;
      p.x += (p.vx + Math.sin(p.wobble) * p.wobbleAmp) * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.flip += p.flipSpeed * dt;
      this.particles[keep++] = p;
    }
    this.particles.length = keep;
    return fired;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const fade = this.elapsed > FADE_FROM ? Math.max(0, 1 - (this.elapsed - FADE_FROM) / (DURATION - FADE_FROM)) : 1;
    for (const p of this.particles) {
      const lifeFade = p.kind === 'spark' || p.kind === 'flash' ? 1 - p.age / p.life : 1;
      ctx.globalAlpha = Math.max(0, fade * lifeFade);
      switch (p.kind) {
        case 'flash':
          this.drawFlash(ctx, p);
          break;
        case 'spark': {
          // Tiny and short-lived: a square reads the same as a circle and fills much faster.
          const r = p.w * (1 - (p.age / p.life) * 0.6);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
          break;
        }
        case 'streamer':
          this.drawStreamer(ctx, p);
          break;
        case 'spiral':
          this.drawSpiral(ctx, p);
          break;
        default:
          this.drawPaper(ctx, p);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Position, rotate and optionally squash a piece in one call, instead of save/translate/rotate/restore. */
  private place(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, squash = 1) {
    const { dpr } = this;
    const cos = Math.cos(angle) * dpr;
    const sin = Math.sin(angle) * dpr;
    ctx.setTransform(cos, sin, -sin * squash, cos * squash, x * dpr, y * dpr);
  }

  private fire(burst: Burst) {
    const mouth = this.mouths[burst.side];
    const count = Math.round(this.budget * burst.share);
    const { width: W, height: H } = this;
    const unit = Math.min(W, H);
    const mirror = burst.side === 'left' ? 1 : -1;

    // Muzzle flash and sparks make the firing moment feel physical.
    this.particles.push(this.make('flash', mouth.x, mouth.y, 0, 0, { w: unit * 0.16 * burst.power, life: 0.2 }));
    for (let i = 0, sparks = this.lite ? 6 : 14; i < sparks; i++) {
      const a = (mirror > 0 ? -Math.PI / 4 : (-3 * Math.PI) / 4) + rand(-0.5, 0.5);
      const v = unit * rand(1.6, 2.8) * burst.power;
      this.particles.push(this.make('spark', mouth.x, mouth.y, Math.cos(a) * v, Math.sin(a) * v, { w: rand(1.5, 3), life: rand(0.25, 0.45), color: pick(['#FFFFFF', '#FFF1B8', '#FFCA16']) }));
    }

    for (let i = 0; i < count; i++) {
      // Aim each piece at a random point across the screen: a wide fan that reaches the top,
      // the centre and the opposite edge, biased towards the far side of the screen.
      const across = Math.pow(Math.random(), 0.85);
      const tx = burst.side === 'left' ? W * (-0.05 + across * 1.1) : W * (1.05 - across * 1.1);
      const ty = H * rand(-0.08, 0.72);
      const kind = this.pickKind();
      const drag = kind === 'streamer' ? rand(1.0, 1.35) : kind === 'spiral' ? rand(1.2, 1.5) : rand(1.35, 1.85);
      const gravity = kind === 'streamer' ? rand(0.55, 0.8) : kind === 'big' ? rand(0.75, 0.95) : rand(0.6, 0.85);
      // Launch fast enough that air drag brings the piece to rest near its target, plus lift
      // to offset the gravity it meets on the way up.
      const reach = rand(0.95, 1.3) * burst.power;
      const vx = (tx - mouth.x) * drag * reach;
      const vy = (ty - mouth.y) * drag * reach - (this.height * 0.62 * gravity) / drag * rand(0.75, 1.05);
      this.particles.push(this.make(kind, mouth.x + rand(-6, 6), mouth.y + rand(-6, 6), vx, vy, { drag, gravity, life: rand(4.6, 6) }));
    }
  }

  private pickKind(): Kind {
    const r = Math.random();
    if (r < 0.46) return 'paper';
    if (r < 0.74) return 'square';
    if (r < (this.lite ? 0.84 : 0.88)) return 'streamer';
    // Spirals are the costliest shape to draw, so the lite tier swaps them for big paper.
    if (r < 0.95 || this.lite) return 'big';
    return 'spiral';
  }

  private make(kind: Kind, x: number, y: number, vx: number, vy: number, extra: Partial<Particle>): Particle {
    const unit = Math.min(this.width, this.height);
    const scale = Math.max(0.75, Math.min(1.25, unit / 700));
    const metallic = kind === 'streamer' && !this.lite && Math.random() < 0.18;
    const size: Record<Kind, [number, number]> = {
      paper: [rand(6, 10) * scale, rand(10, 16) * scale],
      square: [rand(6, 9) * scale, 0],
      big: [rand(12, 17) * scale, rand(16, 24) * scale],
      streamer: [rand(2.6, 4.2) * scale, rand(34, 70) * scale],
      spiral: [rand(9, 13) * scale, rand(2.2, 3.2) * scale],
      spark: [2, 0],
      flash: [0, 0],
    };
    const [w, h] = size[kind];
    const color = extra.color ?? (metallic ? GOLD : pick(PALETTE));
    return {
      kind,
      x,
      y,
      vx,
      vy,
      drag: 1.5,
      gravity: 0.7,
      angle: rand(0, Math.PI * 2),
      spin: rand(-12, 12),
      flip: rand(0, Math.PI * 2),
      flipSpeed: rand(5, 13),
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(2.5, 5.5),
      wobbleAmp: kind === 'streamer' ? rand(18, 40) : rand(20, 55),
      w,
      h: h || w,
      metallic,
      back: BACK.get(color) ?? color,
      age: 0,
      life: 5,
      ...extra,
      color,
    };
  }

  private drawPaper(ctx: CanvasRenderingContext2D, p: Particle) {
    // Squashing one axis by cos(flip) fakes a 3D tumble; the back face shows a darker shade.
    const flip = Math.cos(p.flip);
    this.place(ctx, p.x, p.y, p.angle, Math.max(0.12, Math.abs(flip)));
    ctx.fillStyle = flip < 0 ? p.back : p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  }

  private drawStreamer(ctx: CanvasRenderingContext2D, p: Particle) {
    // A ribbon trailing behind its direction of travel, rippling as it flies.
    const heading = Math.atan2(p.vy, p.vx) + Math.PI + Math.sin(p.angle * 0.25) * 0.6;
    const segments = this.lite ? 5 : 9;
    const step = p.h / segments;
    const ripple = 9 / segments;
    this.place(ctx, p.x, p.y, heading);
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const sx = i * step;
      const sy = Math.sin(p.flip + i * 0.9 * ripple) * (3 + i * 0.7 * ripple);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = p.w;
    ctx.strokeStyle = p.color;
    ctx.stroke();
    if (p.metallic) {
      ctx.lineWidth = Math.max(1, p.w * 0.35);
      ctx.strokeStyle = GOLD_SHINE;
      ctx.stroke();
    }
  }

  private drawSpiral(ctx: CanvasRenderingContext2D, p: Particle) {
    // A curled strip of paper: a small coil that spins as it falls.
    this.place(ctx, p.x, p.y, p.angle);
    ctx.beginPath();
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      const r = p.w * (0.25 + t * 0.75);
      const a = t * Math.PI * 3.2 + p.flip * 0.3;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.55 + (t - 0.5) * p.w * 1.6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = p.h;
    ctx.lineCap = 'round';
    ctx.strokeStyle = p.color;
    ctx.stroke();
  }

  private drawFlash(ctx: CanvasRenderingContext2D, p: Particle) {
    const progress = p.age / p.life;
    const radius = p.w * (0.35 + progress * 0.9);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.lite) {
      // A flat disc instead of a radial gradient: much cheaper to fill on weak GPUs.
      ctx.fillStyle = 'rgba(255, 236, 160, 0.7)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(0.35, 'rgba(255, 228, 120, 0.75)');
    gradient.addColorStop(1, 'rgba(255, 202, 22, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
