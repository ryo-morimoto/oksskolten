# Oksskolten Browser Client Demo

*2026-04-04T16:18:26Z by Showboat 0.6.1*
<!-- showboat-id: 081b2354-7e6b-43dc-bb41-0184fb85ac64 -->

Fork元の React SPA を同一 Cloudflare Worker から配信するブラウザクライアント。Workers Static Assets (`ASSETS` binding) で SPA を配信し、Hono API と同一オリジンで動作する。

## Login Page

GitHub OAuth only. The SPA shows a login page with a "Sign in with GitHub" button. Dark mode is auto-detected from the browser preference.

```bash {image}
docs/demo/01-login.png
```

![Login](docs/demo/01-login.png)

## Home (authenticated)

After authentication, the home page shows a greeting and dashboard stats (inbox count, feed count). The sidebar has navigation: Inbox, Search, Bookmarks, Likes, History, and the feed list.

```bash {image}
docs/demo/02-home.png
```

![Home](docs/demo/02-home.png)

## Inbox

The Inbox page shows unread articles. A hint banner explains the inbox concept. The sidebar highlights the active nav item.

```bash {image}
docs/demo/03-inbox.png
```

![Inbox](docs/demo/03-inbox.png)

## Settings — General

Profile (read-only GitHub username), language selector (Japanese/English), and reading preferences (unread indicator, etc.).

```bash {image}
docs/demo/04-settings-general.png
```

![Settings General](docs/demo/04-settings-general.png)

## Settings — Appearance

Layout picker (list/card/magazine/compact), color mode (light/dark/auto), color theme, font selection, and syntax highlighting. All preferences are persisted to the D1 settings table.

```bash {image}
docs/demo/05-settings-appearance.png
```

![Settings Appearance](docs/demo/05-settings-appearance.png)

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
