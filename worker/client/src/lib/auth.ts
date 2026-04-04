let _token: string | null = null;
export const AUTH_LOGOUT_EVENT = "reader:auth-logout";

export function getAuthToken(): string | null {
  if (_token == null) {
    _token = localStorage.getItem("auth_token");
  }
  return _token;
}

export function setAuthToken(token: string | null): void {
  _token = token;
  if (token) {
    localStorage.setItem("auth_token", token);
  } else {
    localStorage.removeItem("auth_token");
  }
}

export function logoutClient(): void {
  setAuthToken(null);
  window.history.replaceState({}, "", "/");
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
}
