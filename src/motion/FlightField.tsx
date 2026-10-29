"use client";
// Hero flight paths (Ellis). Faint arcs that lean toward the cursor through a spring (no bounce-y wobble).
// One rAF loop that only runs while the spring is moving; pointer handlers just store coords (passive).
// Cached canvas rect (resize/scroll). DPR<=2. Pauses offscreen + hidden tab. Static single frame on
// touch / coarse pointers and under prefers-reduced-motion.
import { useEffect, useRef } from "react";

type Path = { y0: number; y1: number; lift: number; w: number; a: number; accent: boolean; k: number };
const K = 120, C = 2 * Math.sqrt(K) * 0.82; // spring stiffness, damping (ζ≈.82: settles with a whisper of overshoot)

export default function FlightField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext("2d")!;
    const mq = (q: string) => window.matchMedia(q).matches;
    const interactive = !mq("(prefers-reduced-motion: reduce)") && !mq("(pointer: coarse)") && mq("(hover: hover)");

    let W = 0, H = 0, dpr = 1, raf = 0, last = 0, visible = true, rect = { left: 0, top: 0 };
    let paths: Path[] = [];
    const tgt = { x: 0, y: 0, on: 0 }, s = { x: 0, y: 0, on: 0, vx: 0, vy: 0, von: 0 };
    let seeded = false;

    const build = () => {
      const n = W < 640 ? 14 : 22;
      paths = Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1);
        return { y0: H * (0.15 + t * 0.95), y1: H * (-0.05 + t * 0.85), lift: H * (0.08 + ((i * 37) % 11) / 60),
          w: i % 6 === 2 ? 1 : 0.75, a: 0.035 + (((i * 53) % 7) / 7) * 0.045, accent: i % 6 === 2, k: 0.75 + ((i * 29) % 9) / 18 };
      });
    };
    const measure = () => { const r = canvas.getBoundingClientRect(); rect = { left: r.left, top: r.top }; return r; };
    const resize = () => {
      const r = measure(); dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build(); draw();
    };

    const SEG = 48, R = 300;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const on = s.on;
      for (const p of paths) {
        ctx.beginPath();
        let near = 0;
        for (let i = 0; i <= SEG; i++) {
          const t = i / SEG;
          let x = -40 + t * (W + 80), y = p.y0 + (p.y1 - p.y0) * t - Math.sin(t * Math.PI) * p.lift;
          if (on > 0.001) {
            const dx = s.x - x, dy = s.y - y, d = Math.sqrt(dx * dx + dy * dy);
            if (d < R) { const f = (1 - d / R) ** 2 * on * p.k; x += dx * f * 0.06; y += dy * f * 0.22; if (f > near) near = f; }
          }
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        const a = p.a + near * 0.07 + (p.accent ? 0.02 : 0);
        ctx.strokeStyle = p.accent ? `rgba(255,181,71,${a.toFixed(3)})` : `rgba(245,244,240,${a.toFixed(3)})`;
        ctx.lineWidth = p.w; ctx.stroke();
      }
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min((now - (last || now)) / 1000, 1 / 30); last = now;
      if (dt > 0) {
        const ax = K * (tgt.x - s.x) - C * s.vx, ay = K * (tgt.y - s.y) - C * s.vy, ao = 60 * (tgt.on - s.on) - 2 * Math.sqrt(60) * s.von;
        s.vx += ax * dt; s.vy += ay * dt; s.von += ao * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.on += s.von * dt;
      }
      draw();
      const moving = Math.abs(tgt.x - s.x) + Math.abs(tgt.y - s.y) > 0.2 || Math.abs(s.vx) + Math.abs(s.vy) > 0.5 || Math.abs(tgt.on - s.on) > 0.002;
      if (moving && visible) raf = requestAnimationFrame(tick); else last = 0;
    };
    const kick = () => { if (!raf && visible) raf = requestAnimationFrame(tick); };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      tgt.x = e.clientX - rect.left; tgt.y = e.clientY - rect.top;
      if (!seeded) { s.x = tgt.x; s.y = tgt.y; seeded = true; }
      tgt.on = tgt.y >= 0 && tgt.y <= H ? 1 : 0; kick();
    };
    const onLeave = () => { tgt.on = 0; kick(); };
    let sp = 0; const onScroll = () => { if (!sp) sp = requestAnimationFrame(() => { sp = 0; measure(); }); };
    const onVis = () => { visible = !document.hidden && inView; if (visible) kick(); };
    let inView = true;

    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    const io = new IntersectionObserver(([en]) => { inView = en.isIntersecting; onVis(); }); io.observe(canvas);
    if (interactive) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave, { passive: true });
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      cancelAnimationFrame(raf); cancelAnimationFrame(sp); ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove); window.removeEventListener("scroll", onScroll);
      document.documentElement.removeEventListener("pointerleave", onLeave); document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden data-motion="flight-field" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}
