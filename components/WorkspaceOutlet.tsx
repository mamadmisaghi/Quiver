"use client";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { quickPage, workspaceNavigation } from "@/lib/workspace-navigation";

const loadBuilder = () => import("./Builder"),
  loadRuns = () => import("@/app/app/run/PaperTrades"),
  loadSettings = () => import("@/app/app/settings/SettingsView");
const Editor = lazy(loadBuilder),
  Runs = lazy(loadRuns),
  Settings = lazy(loadSettings);
export function warmWorkspaceModule(path: string) {
  const load =
    path === "/app/new"
      ? loadBuilder
      : path === "/app/run"
        ? loadRuns
        : path === "/app/settings"
          ? loadSettings
          : null;
  if (load) void load().catch(() => {});
}
type Destination = { url: URL; from: string };
// Only mounted after an in-app navigation, inside Suspense. Direct loads retain server rendering.
function WatchCommit({
  destination,
  reset,
}: {
  destination: Destination;
  reset: (v: null) => void;
}) {
  const path = usePathname(),
    params = useSearchParams(),
    confirmed = useRef<Destination | null>(null);
  const query = params?.toString() ?? "";
  useEffect(() => {
    if (
      path === destination.url.pathname &&
      query === destination.url.searchParams.toString()
    )
      confirmed.current = destination;
    else if (confirmed.current === destination) reset(null);
  }, [path, query, destination, reset]);
  return null;
}
export default function WorkspaceOutlet({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [destination, setDestination] = useState<Destination | null>(null);
  useEffect(() => {
    const follow = (event: Event) => {
      const url = new URL((event as CustomEvent<string>).detail, location.href);
      setDestination(
        quickPage(url.pathname) ? { url, from: location.pathname } : null,
      );
    };
    const back = () => setDestination(null);
    window.addEventListener(workspaceNavigation, follow);
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener(workspaceNavigation, follow);
      window.removeEventListener("popstate", back);
    };
  }, []);
  useEffect(() => {
    if (!destination) return;
    const { url, from } = destination;
    if (path === url.pathname && url.search === location.search) return;
    if (path !== from && path !== url.pathname) {
      setDestination(null);
      return;
    }
    const timer = window.setTimeout(() => {
      if (location.pathname !== url.pathname || location.search !== url.search)
        setDestination(null);
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [path, destination]);
  if (
    !destination ||
    (path !== destination.from && path !== destination.url.pathname)
  )
    return children;
  const { url } = destination,
    params = url.searchParams;
  // The router still owns history, URLs and server navigation. Keep the chosen screen mounted
  // through the route commit, so an in-flight response cannot discard typing or field focus.
  return (
    <Suspense
      fallback={
        <div className="q-page" role="status">
          Opening{" "}
          {url.pathname === "/app/new"
            ? "strategy editor"
            : url.pathname === "/app/run"
              ? "paper trades"
              : "settings"}
          …
        </div>
      }
    >
      <WatchCommit destination={destination} reset={setDestination} />
      {url.pathname === "/app/new" ? (
        <Editor
          key={url.search}
          strategyId={params.get("strategy") ?? ""}
          initialPrompt={params.get("idea") ?? params.get("q") ?? ""}
        />
      ) : url.pathname === "/app/run" ? (
        <Runs />
      ) : (
        <Settings />
      )}
    </Suspense>
  );
}
