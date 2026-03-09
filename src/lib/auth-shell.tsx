import { AuthGate } from '../components/auth/auth-gate'

export function AuthShell({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>
}
