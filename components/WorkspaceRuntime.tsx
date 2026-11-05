"use client";
import WalletRuntimeRoot from "./auth/WalletRuntime";
import { configureWorkspaceApi } from "@/lib/api";
export default function WorkspaceRuntime({
  connected,
  children,
}: {
  connected: boolean;
  children: React.ReactNode;
}) {
  configureWorkspaceApi(connected);
  return <WalletRuntimeRoot>{children}</WalletRuntimeRoot>;
}
