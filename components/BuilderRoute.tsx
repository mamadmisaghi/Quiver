"use client";
import { useSearchParams } from "next/navigation";
import Builder from "./Builder";
export default function BuilderRoute() {
  const params = useSearchParams();
  const id = params?.get("strategy") ?? "",
    idea = params?.get("idea") ?? params?.get("q") ?? "";
  return (
    <Builder
      key={JSON.stringify([id, idea])}
      initialPrompt={idea}
      strategyId={id}
    />
  );
}
