"use client";
import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import DisclosurePanel from "./DisclosurePanel";

export default function SettingsDisclosure({ title, description, children, open = false }: { title: string; description: string; children: React.ReactNode; open?: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const [visited,setVisited]=useState(open);
  const id = useId(), trigger = useRef<HTMLButtonElement>(null);
  return <section className="q-settings-section rounded-[14px] border border-line bg-card" onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented || !expanded) return;
    event.preventDefault(); trigger.current?.focus({ preventScroll: true }); setExpanded(false);
  }}>
    <h2><button ref={trigger} type="button" aria-expanded={expanded} aria-controls={id} onClick={() => {setVisited(true);setExpanded(!expanded)}}
      className="q-disclosure-toggle flex min-h-20 w-full items-center justify-between gap-4 rounded-[14px] px-5 py-5 text-left transition-colors hover:bg-white/[.02] sm:px-6">
      <span><span className="block text-[15px] font-medium text-ink">{title}</span><span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{description}</span></span><ChevronDown size={17} aria-hidden="true" className="shrink-0 text-muted" />
    </button></h2>
    <DisclosurePanel open={expanded} id={id}><div className="grid gap-5 border-t border-line p-5 sm:p-6 lg:grid-cols-2 [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div>div]:border-0 [&>div>div]:bg-transparent [&>div>div]:p-0">{visited&&children}</div></DisclosurePanel>
  </section>;
}
