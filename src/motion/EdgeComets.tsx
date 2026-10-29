"use client";
// Edge comets (Ellis). Small amber pulses travel each strategy edge from source to target (data-flow direction).
// Reads the live edge <path d> owned by StrategyGraph, so comets follow edges when nodes move / relayout.
// One rAF loop per graph; canvas overlay, DPR<=2; pauses offscreen + hidden tab. Mounted only when motion is allowed
// (StrategyGraph keeps its parked static arrowheads under reduced motion / coarse pointers).
import { useEffect, useRef } from "react";

const N = 48; // samples per edge (resampled only when d changes)
type Edge = { g: SVGGElement; p: SVGPathElement; d: string; pts: Float32Array; len: number; hot: boolean; t0: number; dur: number; gap: number };
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2) * 0.35 + t * 0.65; // mostly linear, soft in/out

export default function EdgeComets() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, root = cv.parentElement!, ctx = cv.getContext("2d")!;
    let W = 0, H = 0, dpr = 1, raf = 0, vis = true, edges: Edge[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const sample = (e: Edge) => {
      e.len = e.p.getTotalLength();
      for (let i = 0; i < N; i++) { const q = e.p.getPointAtLength((e.len * i) / (N - 1)); e.pts[i * 2] = q.x; e.pts[i * 2 + 1] = q.y; }
      e.d = e.p.getAttribute("d") || "";
    };
    const scan = () => {
      const now = performance.now();
      edges = Array.from(root.querySelectorAll<SVGGElement>('[data-motion="graph-edge"]')).map((g, i) => {
        const hot = g.dataset.hot === "true", old = edges.find((e) => e.g === g);
        const e: Edge = old ?? { g, p: g.querySelector("path")!, d: "", pts: new Float32Array(N * 2), len: 0, hot,
          t0: now + rnd(0, 1600) + i * 180, dur: (hot ? 2300 : 3600) * rnd(0.88, 1.12), gap: rnd(500, 1800) };
        e.p = g.querySelector("path")!; e.hot = hot; return e;
      });
    };
    const at = (e: Edge, u: number) => { // u in [0,1] → point on sampled polyline
      const f = Math.min(Math.max(u, 0), 1) * (N - 1), i = Math.min(f | 0, N - 2), k = f - i, a = i * 2;
      return [e.pts[a] + (e.pts[a + 2] - e.pts[a]) * k, e.pts[a + 1] + (e.pts[a + 3] - e.pts[a + 1]) * k];
    };
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2); W = root.clientWidth; H = root.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px";
    };
    const frame = (now: number) => {
      raf = 0; if (!vis) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineCap = "round";
      for (const e of edges) {
        if (!e.p.isConnected) continue;
        if (e.p.getAttribute("d") !== e.d) sample(e); // node moved / relayout → follow the new path
        const op = e.g.style.opacity === "" ? 1 : +e.g.style.opacity; // respects reveal (0) and hover-dim (.25)
        let t = (now - e.t0) / e.dur;
        if (t >= 1) { if (now - e.t0 < e.dur + e.gap) continue; e.t0 = now; e.dur = (e.hot ? 2300 : 3600) * rnd(0.88, 1.12); e.gap = rnd(e.hot ? 400 : 900, e.hot ? 1400 : 2600); t = 0; }
        if (t < 0 || op < 0.02 || e.len < 1) continue;
        const head = ease(t), tail = Math.min(0.42, Math.max(26, Math.min(72, e.len * 0.22)) / e.len);
        const fade = Math.min(1, t * 6, (1 - t) * 6) * op * (e.hot ? 1 : 0.6); // fade in/out at the ports
        const r = e.hot ? 1.6 : 1.25, S = 10;
        for (let s = 0; s < S; s++) { // tail: segments thinning + fading toward the source
          const u0 = head - tail * (1 - s / S), u1 = head - tail * (1 - (s + 1) / S); if (u1 <= 0) continue;
          const [x0, y0] = at(e, u0), [x1, y1] = at(e, u1), k = (s + 1) / S;
          ctx.strokeStyle = `rgba(255,181,71,${(k * k * 0.75 * fade).toFixed(3)})`; ctx.lineWidth = r * 2 * (0.35 + 0.65 * k);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        const [hx, hy] = at(e, head); // soft head: tight warm core + faint 4px halo (no bloom)
        ctx.fillStyle = `rgba(255,181,71,${(0.16 * fade).toFixed(3)})`; ctx.beginPath(); ctx.arc(hx, hy, r + 2.6, 0, 6.2832); ctx.fill();
        ctx.fillStyle = `rgba(255,222,170,${(0.95 * fade).toFixed(3)})`; ctx.beginPath(); ctx.arc(hx, hy, r, 0, 6.2832); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    const go = () => { if (!raf && vis) raf = requestAnimationFrame(frame); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver(([en]) => { vis = en.isIntersecting && !document.hidden; if (vis) go(); else stop(); });
    const onVis = () => { vis = !document.hidden; if (vis) go(); else stop(); };
    const ro = new ResizeObserver(() => { resize(); scan(); });
    const mo = new MutationObserver(scan); // edges revealed / removed by the builder
    resize(); scan(); io.observe(cv); ro.observe(root); mo.observe(root.querySelector("svg") ?? root, { childList: true, subtree: false });
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); io.disconnect(); ro.disconnect(); mo.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return <canvas ref={ref} aria-hidden data-motion="graph-comets" className="pointer-events-none absolute left-0 top-0" />;
}
