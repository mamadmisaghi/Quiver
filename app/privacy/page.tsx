import { redirect } from "next/navigation";
// M4.9.2 parity: a stable /privacy URL. The (draft) privacy notes live in the terms page.
export default function Privacy() { redirect("/terms#privacy"); }
