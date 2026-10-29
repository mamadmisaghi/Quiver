"use client";
// Ellis: one tiny observer for hooks CSS can't animate alone. Off under reduced motion (everything stays static).
// - reveal / read-row: IntersectionObserver sets data-in (CSS does the rise). Hidden state only exists once
//   html[data-mo] is set here, so no-JS and pre-hydration render the static end state.
// - replay-cursor (x1 attr), trigger-hold (inline width), trigger-state (data-state): FLIP/crossfade via WAAPI,
//   transform + opacity only, so nothing shifts layout.
import { useEffect } from "react";

const EASE = "cubic-bezier(.22,1,.36,1)";
const REVEAL = '[data-motion="reveal"],[data-motion="read-row"]';
const ATTR_HOOKS: [string, string][] = [['[data-motion="replay-cursor"]', "x1"], ['[data-motion="trigger-hold"]', "style"], ['[data-motion="trigger-state"]', "data-state"]];

export default function MotionHooks() {
  useEffect(() => {
    let stop = () => {};
    const go = () => { stop = start(); };
    const idle = "requestIdleCallback" in window;
    const id = idle ? requestIdleCallback(go, { timeout: 1500 }) : window.setTimeout(go, 600);
    return () => { if (idle) cancelIdleCallback(id); else clearTimeout(id); stop(); };
  }, []);
  return null;
}

// started after the page is idle so it never competes with hydration / LCP
function start(): () => void {
  {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return () => {};
    const root = document.documentElement;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { (e.target as HTMLElement).dataset.in = ""; io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    const watch = (n: Pick<ParentNode, "querySelectorAll">) => n.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => { if (!("in" in el.dataset)) io.observe(el); });
    watch(document);
    root.dataset.mo = "";
    const anim = (el: Element, k: Keyframe[], ms: number) => el.animate(k, { duration: ms, easing: EASE });
    // attribute changes: observed per hook element only (no subtree), each with its own attributeFilter
    const ao = new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target as SVGElement & HTMLElement;
        const hook = el.getAttribute("data-motion"); if (!hook || m.oldValue == null) continue;
        if (hook === "replay-cursor") {
          const dx = Number(m.oldValue) - Number(el.getAttribute("x1"));
          if (dx) anim(el, [{ transform: `translateX(${dx}px)` }, { transform: "none" }], 320);
        } else if (hook === "trigger-hold") {
          const was = /width:\s*([\d.]+)%/.exec(m.oldValue)?.[1], now = /width:\s*([\d.]+)%/.exec(el.getAttribute("style") || "")?.[1];
          if (was && now && Number(now) > 0 && was !== now) { el.style.transformOrigin = "left"; anim(el, [{ transform: `scaleX(${Number(was) / Number(now)})` }, { transform: "none" }], 600); }
        } else if (hook === "trigger-state" && m.oldValue !== el.getAttribute("data-state")) {
          anim(el, [{ opacity: 0.35, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], 360);
        }
      }
    });
    const seen = new WeakSet<Element>();
    const hookAttrs = (n: Pick<ParentNode, "querySelectorAll">) => {
      for (const [sel, attr] of ATTR_HOOKS) {
        const els = [...n.querySelectorAll(sel)]; if (n instanceof Element && n.matches(sel)) els.push(n);
        for (const el of els) if (!seen.has(el)) { seen.add(el); ao.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: [attr] }); }
      }
    };
    hookAttrs(document);
    // structure: childList only (no attribute traffic), to pick up hooks React mounts later
    const mo = new MutationObserver((ms) => {
      for (const m of ms) m.addedNodes.forEach((n) => { if (n instanceof Element) { if (n.matches(REVEAL)) io.observe(n); watch(n); hookAttrs(n); } });
    });
    mo.observe(document.body, { subtree: true, childList: true });
    return () => { io.disconnect(); mo.disconnect(); ao.disconnect(); delete root.dataset.mo; };
  }
}
