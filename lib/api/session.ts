// Session events shared by the live adapter and data hooks (no React, no adapter imports → no cycles).
const subs = new Set<() => void>();
/** Fires after a successful sign-in so every screen reloads its data. */
export const onSession = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const emitSession = () => subs.forEach((f) => f());
const FLAG = "quiver.signedIn";
export const wasSignedIn = () => typeof window !== "undefined" && localStorage.getItem(FLAG) === "1";
export const markSignedIn = (v: boolean) => { if (typeof window !== "undefined") { if (v) localStorage.setItem(FLAG, "1"); else localStorage.removeItem(FLAG); } };
