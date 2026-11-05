"use client";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { Popover } from "radix-ui";

/** Pointer details grow from their trigger. Keyboard inspection is immediate. */
export default function NodeDetails({ trigger, label, className, children, sideOffset = 8 }: {
  trigger: ReactElement; label: string; className: string; children: ReactNode; sideOffset?: number;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [keyboard, setKeyboard] = useState(true);
  return <Popover.Root>
    <Popover.Trigger asChild onPointerDownCapture={() => setKeyboard(false)} onKeyDownCapture={() => setKeyboard(true)}>{trigger}</Popover.Trigger>
    <Popover.Portal><Popover.Content ref={content} side="bottom" align="center" collisionPadding={16} sideOffset={sideOffset}
      aria-label={label} className={`q-node-details-motion ${className}`} data-instant={keyboard ? "" : undefined}
      onOpenAutoFocus={(event) => { if (!keyboard) event.preventDefault(); }}
      onEscapeKeyDown={() => { if (content.current) content.current.dataset.instant = ""; }}>
      {children}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
