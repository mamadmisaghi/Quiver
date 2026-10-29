import Link from "@/components/Link";
import SiteHeader from "@/components/SiteHeader";

export const metadata = { title: "Page not found · Quiver" };
/** M3.5: unknown routes render a calm 404 (the API also returns 404 not_found for unknown routes now). */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid min-h-[60vh] max-w-[560px] place-items-center px-5 py-20 text-center">
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted">404</p>
          <h1 className="mt-3 text-[28px] font-medium tracking-tight">Page not found</h1>
          <p className="mt-3 text-[15px] text-ink-2">That link doesn&apos;t go anywhere. It may have moved, or the address has a typo.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/" className="btn rounded-full bg-accent px-5 py-2.5 text-[14px] font-medium text-bg">Go home</Link>
            <Link href="/app" className="btn rounded-full border border-line-2 px-5 py-2.5 text-[14px] text-ink-2 hover:border-white/30">Open the app</Link>
          </div>
        </div>
      </main>
    </>
  );
}
