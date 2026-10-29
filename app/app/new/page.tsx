import Builder from "@/components/Builder";
export const metadata = { title: "New strategy — Quiver" };
/** ?idea=… prefills the prompt (landing "Seven things it reads" rows); Builder reads it on mount. Never auto-submitted.
 *  LCP: the page is fully static, so the first paint is final (no Suspense fallback swapped out by a streamed copy). */
export default function NewStrategy() {
  return <Builder />;
}
