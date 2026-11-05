"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export default function DisclosurePanel({ open, id, focusFirst = false, children }: {
  open: boolean; id?: string; focusFirst?: boolean; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open && focusFirst) panel.current?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])")?.focus({ preventScroll: true });
  }, [open, focusFirst]);
  return <div ref={panel} id={id} className="q-disclosure" data-open={open} aria-hidden={!open} inert={!open}>
    <div className="q-disclosure-clip">{children}</div>
  </div>;
}
