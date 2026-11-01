"use client";
import { ChevronDown } from "lucide-react";
export default function SettingsDisclosure({ title, description, children, open = false }: { title: string; description: string; children: React.ReactNode; open?: boolean }) {
  return <details className="group/settings rounded-[14px] border border-line bg-card" open={open || undefined}>
    <summary className="flex min-h-20 list-none items-center justify-between gap-4 rounded-[14px] px-5 py-5 transition-colors hover:bg-white/[.02] sm:px-6"><span><span className="block text-[15px] font-medium text-ink">{title}</span><span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{description}</span></span><ChevronDown size={17} className="shrink-0 text-muted transition-transform group-open/settings:rotate-180" /></summary>
    <div className="grid gap-5 border-t border-line p-5 sm:p-6 lg:grid-cols-2 [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div>div]:border-0 [&>div>div]:bg-transparent [&>div>div]:p-0">{children}</div>
  </details>;
}
