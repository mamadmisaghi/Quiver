import { notFound } from "next/navigation";
import { Handle } from "@/lib/contracts/social";
import AppShell from "@/components/AppShell";
import Wrap from "@/components/Wrap";
import ProfileView from "@/components/social/ProfileView";
export const metadata = { title: "Trader — Quiver" };
// M5.5: /u/@handle. Demo handles prerender; others resolve on the client. The handle is passed through exactly as given.
export function generateStaticParams() { return ["@demo_marco", "@demo_lena", "@demo_okafor"].map((h) => ({ handle: encodeURIComponent(h) })); }
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  let h = handle;
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(h); i++) { try { h = decodeURIComponent(h); } catch { break; } }
  if (!Handle.safeParse(h).success) notFound(); // backstop; proxy.ts already 404s these (and mock-unknown handles) before streaming starts
  return <AppShell><Wrap><ProfileView handle={h} /></Wrap></AppShell>;
}
