// M5.5: a trader handle that links to their public profile. The handle is shown and encoded exactly as the server returns it (M5.10).
import Link from "@/components/Link";
export const profileHref = (handle: string) => `/u/${encodeURIComponent(handle)}`;
export default function HandleLink({ handle, className = "" }: { handle: string; className?: string }) {
  return <Link href={profileHref(handle)} className={`-my-3 inline-block py-3 font-mono underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent ${className}`} data-testid="handle-link">{handle}</Link>;
}
