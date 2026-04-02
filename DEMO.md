# Oksskolten Browser Client Demo

*2026-04-02T00:36:19Z*

Fork元の React SPA を同一 Cloudflare Worker から配信するブラウザクライアント。Workers Static Assets + ASSETS binding で SPA を配信し、Hono API と同一オリジンで動作する。

## Login Page

GitHub OAuth only. The SPA shows a login page with a "Sign in with GitHub" button. Dark mode is auto-detected from the browser preference.

```bash {image}
echo docs/demo/01-login.png
```

![2b73d4f7-2026-04-02](2b73d4f7-2026-04-02.png)

## Home (authenticated)

After authentication, the home page shows a greeting and dashboard stats (inbox count, feed count). The sidebar has navigation: Inbox, Search, Bookmarks, Likes, History, and the feed list.

```bash {image}
echo docs/demo/02-home.png
```

![01e1ce84-2026-04-02](01e1ce84-2026-04-02.png)

## Inbox

The Inbox page shows unread articles. A hint banner explains the inbox concept. The sidebar highlights the active nav item.

```bash {image}
echo docs/demo/03-inbox.png
```

![dbc85c44-2026-04-02](dbc85c44-2026-04-02.png)

## Settings — General

Profile (read-only GitHub username), language selector (Japanese/English), and reading preferences (unread indicator, etc.).

```bash {image}
echo docs/demo/04-settings-general.png
```

![21c83802-2026-04-02](21c83802-2026-04-02.png)

## Settings — Appearance

Theme picker, color mode, font selection, and syntax highlighting theme. All preferences are persisted to the D1 settings table.

```bash {image}
echo docs/demo/05-settings-appearance.png
```

![e96e24b8-2026-04-02](e96e24b8-2026-04-02.png)

## API Health Check

Public endpoint intercepted before OAuthProvider — no auth required.

```bash
curl -s http://localhost:8787/api/health | python3 -m json.tool
```

```output
{
    "ok": true,
    "version": "0.1.0",
    "environment": "production"
}
```

## Architecture

- **Static Assets**: `[assets]` binding with `not_found_handling = "single-page-application"` and `html_handling = "none"`
- **Auth**: OAuthProvider `resolveExternalToken` for JWT + MCP OAuth coexistence. Browser OAuth at `/auth/github/*` (outside `/api/` prefix)
- **Public routes**: Intercepted before `oauth.fetch()` (OAuthProvider rejects all `/api/*` without Bearer token)
- **Stack**: React 19 + Vite + Tailwind 4 + SWR + Radix UI + Hono + D1
