"use client";
import { useEffect, useState } from "react";
/** false on the server and under prefers-reduced-motion; static end states render by default. */
export function useMotionOK() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setOk(!m.matches);
    set(); m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);
  return ok;
}

/** Continuous/ambient motion gate: also false on touch / coarse pointers (they get the static end state). */
export function useFineMotion() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const qs = ["(prefers-reduced-motion: reduce)", "(pointer: coarse)", "(hover: none)"].map((q) => window.matchMedia(q));
    const set = () => setOk(!qs.some((m) => m.matches));
    set(); qs.forEach((m) => m.addEventListener("change", set));
    return () => qs.forEach((m) => m.removeEventListener("change", set));
  }, []);
  return ok;
}
