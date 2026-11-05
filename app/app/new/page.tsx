import { Suspense } from "react";
import BuilderRoute from "@/components/BuilderRoute";
export const metadata = { title: "New strategy — Quiver" };
export default function NewStrategy() {
  return <Suspense fallback={<div className="q-page" role="status">Opening strategy editor…</div>}><BuilderRoute/></Suspense>;
}
