import type { Env } from '../index'

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'

/**
 * Redirect to GitHub OAuth with our app's client_id.
 * Stores the original OAuth request info in KV so /callback can retrieve it.
 */
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request)

  // Store OAuth request in KV (keyed by a random state token)
  const stateKey = crypto.randomUUID()
  await env.OAUTH_KV.put(`github_state:${stateKey}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: 600, // 10 minutes
  })

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: new URL('/callback', request.url).href,
    state: stateKey,
    scope: 'read:user',
  })

  return Response.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`, 302)
}

/**
 * Handle GitHub OAuth callback:
 * 1. Exchange code for GitHub token
 * 2. Verify user identity (must be GITHUB_ALLOWED_USERNAME)
 * 3. Complete MCP authorization
 */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateKey = url.searchParams.get('state')

  if (!code || !stateKey) {
    return new Response('Missing code or state', { status: 400 })
  }

  // Retrieve original OAuth request from KV
  const stored = await env.OAUTH_KV.get(`github_state:${stateKey}`)
  if (!stored) {
    return new Response('Invalid or expired state', { status: 400 })
  }
  await env.OAUTH_KV.delete(`github_state:${stateKey}`)
  const oauthReqInfo = JSON.parse(stored)

  // Exchange code for GitHub access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })

  const tokenData = await tokenRes.json<{ access_token?: string; error?: string }>()
  if (!tokenData.access_token) {
    return new Response(`GitHub token exchange failed: ${tokenData.error}`, { status: 400 })
  }

  // Verify user identity
  const userRes = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'oksskolten-mcp',
      Accept: 'application/json',
    },
  })

  const userData = await userRes.json<{ login?: string }>()
  if (!userData.login) {
    return new Response('Failed to get GitHub user info', { status: 500 })
  }

  if (userData.login !== env.GITHUB_ALLOWED_USERNAME) {
    return new Response('Unauthorized: user not allowed', { status: 403 })
  }

  // Complete MCP OAuth authorization
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: userData.login,
    metadata: { provider: 'github' },
    scope: oauthReqInfo.scope || ['read', 'write'],
    props: {
      username: userData.login,
    },
  })

  return Response.redirect(redirectTo, 302)
}
