import { useState, useEffect, type ReactNode } from "react";
import { getAuthToken, setAuthToken, AUTH_LOGOUT_EVENT } from "@/lib/auth";
import { LoginPage } from "@/pages/login-page";

interface AuthGateProps {
  children: ReactNode;
}

/**
 * Gates the entire app behind authentication.
 *
 * Flow:
 * 1. Check if ?code= is present (returning from OAuth callback)
 *    → Exchange it for a JWT via POST /auth/github/exchange
 * 2. If we have a token, verify it via GET /api/me
 * 3. If no token or verification fails, show LoginPage
 */
export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    async function checkAuth() {
      // Handle OAuth callback code
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code) {
        // Clean the URL immediately
        url.searchParams.delete("code");
        window.history.replaceState({}, "", url.pathname + url.search);

        try {
          const res = await fetch("/auth/github/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          if (res.ok) {
            const { token } = await res.json() as { token: string };
            setAuthToken(token);
          }
        } catch {
          // Exchange failed — fall through to token check
        }
      }

      // Verify existing token
      const token = getAuthToken();
      if (!token) {
        setState("unauthenticated");
        return;
      }

      try {
        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setState(res.ok ? "authenticated" : "unauthenticated");
        if (!res.ok) setAuthToken(null);
      } catch {
        setState("unauthenticated");
        setAuthToken(null);
      }
    }

    checkAuth();

    // Listen for logout events (e.g. from 401 handler)
    const handleLogout = () => setState("unauthenticated");
    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout);
  }, []);

  if (state === "loading") return null;
  if (state === "unauthenticated") return <LoginPage />;
  return <>{children}</>;
}
