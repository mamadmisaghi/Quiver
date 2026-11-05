import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import type { useRouter } from "next/navigation";
export const quickPages = ["/app/new", "/app/run", "/app/settings"] as const;
export const workspaceNavigation = "quiver:workspace-navigation";
export const quickPage = (path: string) => quickPages.some((p) => p === path);
export function warmRoute(router: ReturnType<typeof useRouter>, href: string) {
  if (
    !window.crypto?.subtle ||
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData
  )
    return;
  const target = new URL(href, window.location.href);
  if (target.origin !== window.location.origin) return;
  if (quickPage(target.pathname))
    router.prefetch(href, { kind: PrefetchKind.FULL });
  else router.prefetch(href);
}
