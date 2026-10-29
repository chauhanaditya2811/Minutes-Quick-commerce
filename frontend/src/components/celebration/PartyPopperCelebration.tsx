import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BURSTS, ConfettiEngine, DURATION, type Mouths, type Side } from './confettiEngine';

/** Popper mouth position inside its square SVG box (fractions of the box size). */
const MOUTH = { x: 0.72, y: 0.28 };
/** Distance of each popper box from the viewport corner, in px. */
const INSET = 8;
const ENTER = 0.14; // s: poppers spring into view
const ANTICIPATE = 0.22; // s: brief pull-back before the first shot
const FADE_START = 4.1;
const FADE_END = 4.9;

const popperSize = (w: number, h: number) => Math.round(Math.min(136, Math.max(78, Math.min(w, h) * 0.2)));

const mouthsFor = (w: number, h: number): Mouths => {
  const size = popperSize(w, h);
  const top = h - INSET - size;
  return {
    left: { x: INSET + MOUTH.x * size, y: top + MOUTH.y * size },
    right: { x: w - INSET - MOUTH.x * size, y: top + MOUTH.y * size },
  };
};

const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Pose of a popper at time t: springs in, pulls back, kicks with recoil on every shot it fires,
 * then sinks away. Angles are for the left popper and mirrored for the right one.
 */
function poseAt(t: number, side: Side) {
  let rotate = 0;
  let shift = 0;
  let scaleX = 1;
  let scaleY = 1;

  const enter = easeOutBack(clamp01(t / ENTER));
  const anticipation = clamp01((t - ENTER) / (ANTICIPATE - ENTER)) * (t < ANTICIPATE ? 1 : 0);
  rotate += 7 * anticipation;
  scaleX *= 1 - 0.05 * anticipation;
  scaleY *= 1 + 0.05 * anticipation;

  for (const burst of BURSTS) {
    if (burst.side !== side || t < burst.at) continue;
    const since = t - burst.at;
    // Sharp kick, then a springy settle.
    const kick = since < 0.03 ? since / 0.03 : Math.exp(-(since - 0.03) / 0.09) * Math.cos((since - 0.03) * 22);
    rotate -= 11 * kick * burst.power;
    shift -= 9 * kick * burst.power;
    scaleX *= 1 + 0.08 * kick * burst.power;
    scaleY *= 1 - 0.06 * kick * burst.power;
  }

  const fade = clamp01((t - FADE_START) / (FADE_END - FADE_START));
  const opacity = clamp01(t / (ENTER * 0.6)) * (1 - fade);
  const rise = (1 - enter) * 40 + fade * 30;
  const scale = (0.55 + 0.45 * enter) * (1 - fade * 0.2);
  return { rotate, shift, scaleX: scaleX * scale, scaleY: scaleY * scale, rise, opacity };
}

interface Props {
  /** Called once the celebration has fully finished, so the overlay can be removed. */
  onDone: () => void;
}

/**
 * Full-screen party-popper celebration: two cannons fire staggered bursts of confetti, ribbons and
 * paper strips across the whole viewport, then everything falls and fades within about 6 seconds.
 * The overlay never takes pointer events, and the confirmation card sits above it.
 */
export default function PartyPopperCelebration({ onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      doneRef.current();
      return;
    }

    let width = window.innerWidth;
    let height = window.innerHeight;
    const fit = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const size = popperSize(width, height);
      for (const el of [leftRef.current, rightRef.current]) {
        if (el) {
          el.style.width = `${size}px`;
          el.style.height = `${size}px`;
        }
      }
    };
    fit();

    const engine = new ConfettiEngine(width, height, mouthsFor(width, height));
    const onResize = () => {
      fit();
      engine.resize(width, height, mouthsFor(width, height));
    };
    window.addEventListener('resize', onResize);

    const applyPose = (el: HTMLDivElement | null, side: Side, t: number) => {
      if (!el) return;
      const pose = poseAt(t, side);
      // The right popper's artwork is mirrored in CSS; mirror its motion here. Recoil pushes
      // each cone back along its own axis (down and away from the centre).
      const mirror = side === 'left' ? 1 : -1;
      el.style.opacity = String(pose.opacity);
      el.style.transform =
        `translateY(${pose.rise}px) translate(${pose.shift * 0.7 * mirror}px, ${-pose.shift * 0.7}px) ` +
        `rotate(${pose.rotate * mirror}deg) scale(${pose.scaleX}, ${pose.scaleY})`;
    };

    let frame = 0;
    let last: number | null = null;
    let finished = false;
    const tick = (now: number) => {
      // Clamp the step so a backgrounded tab resumes smoothly instead of jumping ahead.
      const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      engine.step(dt);
      engine.draw(ctx);
      applyPose(leftRef.current, 'left', engine.time);
      applyPose(rightRef.current, 'right', engine.time);
      if (engine.done || engine.time >= DURATION) {
        finished = true;
        ctx.clearRect(0, 0, width, height);
        doneRef.current();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      if (!finished) ctx.clearRect(0, 0, width, height);
    };
  }, []);

  // Rendered into <body> so it layers against the whole page. The confetti sits above the navbar
  // and floating buttons but below the confirmation card, so the text always stays readable;
  // the two cannons get their own layer above the card so they stay clearly visible.
  return createPortal(
    <>
      <div className="celebration" aria-hidden="true">
        <canvas className="celebration__canvas" ref={canvasRef} />
      </div>
      <div className="celebration celebration--poppers" aria-hidden="true">
        <div className="celebration__popper celebration__popper--left" ref={leftRef}><Popper /></div>
        <div className="celebration__popper celebration__popper--right" ref={rightRef}><Popper /></div>
      </div>
    </>,
    document.body
  );
}

/** A festive striped party-popper cone, drawn pointing up and to the right. */
function Popper() {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" focusable="false">
      <defs>
        <clipPath id={`${id}-cone`}>
          <path d="M0 -3.5 L78 -19 Q82 0 78 19 L0 3.5 Z" />
        </clipPath>
        <linearGradient id={`${id}-shade`} x1="0" y1="-20" x2="0" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#7c2d12" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={`${id}-mouth`} cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#4a1d0a" />
          <stop offset="1" stopColor="#9a3412" />
        </radialGradient>
      </defs>
      {/* Tip at (14, 86); the cone points 45° up-right so its mouth sits at about (72, 28). */}
      <g transform="translate(14 86) rotate(-45)">
        <ellipse cx="38" cy="24" rx="36" ry="5" fill="#111827" opacity="0.12" />
        <g clipPath={`url(#${id}-cone)`}>
          <rect x="-2" y="-22" width="86" height="44" fill="#FFCA16" />
          {[4, 20, 36, 52, 68].map((x) => (
            <path key={x} d={`M${x} -24 l9 0 l-14 48 l-9 0 Z`} fill="#EF4444" />
          ))}
          {[12, 28, 44, 60, 76].map((x) => (
            <path key={x} d={`M${x} -24 l3 0 l-14 48 l-3 0 Z`} fill="#FFFFFF" opacity="0.9" />
          ))}
          <rect x="-2" y="-22" width="86" height="44" fill={`url(#${id}-shade)`} />
        </g>
        <path d="M0 -3.5 L78 -19 Q82 0 78 19 L0 3.5 Z" fill="none" stroke="#7c2d12" strokeOpacity="0.35" strokeWidth="1.2" />
        <ellipse cx="79" cy="0" rx="5.5" ry="19.5" fill={`url(#${id}-mouth)`} />
        <ellipse cx="79" cy="0" rx="5.5" ry="19.5" fill="none" stroke="#FFE38A" strokeWidth="2.6" />
        {/* Confetti peeking out of the mouth before it fires. */}
        <rect x="80" y="-11" width="4" height="6" rx="1" fill="#3B82F6" transform="rotate(20 82 -8)" />
        <rect x="81" y="2" width="4" height="6" rx="1" fill="#22C55E" transform="rotate(-25 83 5)" />
        <rect x="79" y="-3" width="3" height="5" rx="1" fill="#EC4899" />
      </g>
    </svg>
  );
}
