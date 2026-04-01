import { AuthShell } from "@/lib/auth-shell";

export default function App() {
  return (
    <AuthShell>
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <h1 className="text-2xl font-bold">Oksskolten</h1>
      </div>
    </AuthShell>
  );
}
