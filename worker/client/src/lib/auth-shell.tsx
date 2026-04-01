import type { ReactNode } from "react";
import { AuthGate } from "@/components/auth/auth-gate";

export function AuthShell({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
