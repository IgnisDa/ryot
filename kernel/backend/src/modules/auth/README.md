# Auth

Every client — web, iOS, and Android — authenticates the same way: an `Authorization: Bearer
<token>` header on every request. There are no cookies and no `credentials: "include"` fetch
anywhere in the stack, and the server requires no operator-configured CORS allowlist.

Every client is a portable client of a user-chosen backend, so none of them has an origin the
server can know in advance — the Capacitor shells each run from their own fixed local origin
(`capacitor://localhost` on iOS, `https://localhost` on Android; neither is the app's real network
origin, and the two are not even the same scheme as each other). Any scheme requiring the server to
enumerate client origins is therefore unavailable to us. The entity-interest WebSocket makes the
same choice independently, authenticating with its own opaque single-use ticket (see
`../entity-interest/README.md`).

## Transport and CORS

`service.ts` enables better-auth's `bearer({ requireSignature: true })` plugin. Its `before` hook
rewrites an incoming `Authorization: Bearer <token>` header into the session cookie better-auth
expects internally; its `after` hook adds a `set-auth-token` response header (plus
`Access-Control-Expose-Headers`) on any response that establishes a session, e.g. sign-in or the
one-time-token verify endpoint. `requireSignature` closes a self-signing gap: without it, an
unsigned token (one with no `.` in it) is signed and then verified by the server against itself, so
the signature check contributes nothing against a client that never held a signed token to begin
with. Every token this app ever hands out already has a signature — `setSessionCookie` always signs
it — so requiring one is not a compatibility change for any existing flow.

`boot/server.ts` applies one global `HttpMiddleware.cors({ allowedOrigins: ["*"], credentials: false
})` to the whole API, with no per-route exception and nothing for an operator to configure. This is
safe for the credential this policy is about — the bearer token is not an ambient credential, a
browser never attaches one to a cross-origin request on its own — so wildcard, non-credentialed CORS
does not hand a bearer token to a page the user never authorized to have it. This is narrower than
"nothing ambient to protect": the server still emits a signed `SameSite=Lax` session cookie
internally (see below) and `resolveCurrentUser` still accepts one, so a same-origin web deployment
does carry an ambient credential. `SameSite=Lax` is what carries the CSRF weight for that cookie; it
is not CORS's job here, and the wildcard CORS policy is safe precisely because it governs a
different, non-ambient credential (the bearer token) than the one that is ambient (the session
cookie). Do not set `exposedHeaders` on that middleware call — see `AGENTS.md`.

Better Auth's own origin checks are configured to match. `trustedOrigins` is a redirect-target
allowlist — `frontendUrl`, the app's deep-link schemes, and the dev-only `exp://` entry — consulted
both by better-auth's own OAuth machinery and directly by `oidcTokenRedirect` (below), and never a
CORS or CSRF origin list. `advanced.disableCSRFCheck` is on because sign-in and sign-up otherwise run
a Sec-Fetch origin check that rejects exactly the unknowable client origins above; the same
non-ambient-credential argument applies to that check as to CORS. `disableOriginCheck` stays off so
`trustedOrigins` keeps gating redirect targets.

The one place origins still matter is S3 direct uploads, which go browser-to-bucket and so obey
your bucket's policy rather than Ryot's.

## Token storage

The client persists the session token in `localStorage`, keyed by server origin
(`ryot:session-token:<origin>`, see `kernel/client/src/persistence/storage.ts`), on web and native
alike. An XSS payload can read that token directly, which an httpOnly cookie would have prevented.
The accepted trade is narrower than it first appears: script running in the app's own origin could
always issue authenticated requests regardless of where the credential lived, so what is lost is
protection against persistent theft, not against session abuse. Pair it with short session expiry;
storage secrecy is not the mitigation.

## OIDC redirect

OIDC cannot mint a bearer token directly: the identity provider finishes with a browser redirect,
and Better Auth establishes that session as a cookie the app cannot read. Web and native use the
same mechanism to bridge that gap — there is no separate popup flow. The client starts the OAuth
flow with `callbackURL` set to a trusted redirect target of its own choosing (a relative
`/auth/callback` on web, `ryot://auth/callback` on native, either with an optional `?redirect=`
appended), and better-auth carries that value through the whole OAuth round trip unresolved, so it
lands verbatim in the callback's `Location` header once sign-in succeeds.

`oidc-redirect.ts`'s `oidcTokenRedirect()` plugin runs as an after-hook on `/callback/*`, the
core social-callback route that `genericOAuth` routes through — it registers no endpoint of its
own. Once better-auth's `oneTimeToken` plugin (`storeToken: "hashed"`,
`expiresIn: 1` minute, `setOttHeaderOnNewSession: true`) has minted a token and exposed it as the
`set-ott` response header for the new session the callback just created, the hook appends that
token to the callback's `Location` as `?token=…` (or `&token=…` if the client's own `redirect` query
is already there) — but only when the target is one the hook is willing to trust:

- a same-origin relative path (`/auth/callback`, what the web client sends) is trusted outright; a
  protocol-relative `//host/...` is explicitly rejected even though it also starts with `/`, because
  a browser reads that as cross-origin
- anything else must satisfy `ctx.context.isTrustedOrigin`, the same `trustedOrigins` check
  better-auth's own OAuth machinery uses — this is what accepts `ryot://auth/callback` and rejects
  an attacker-supplied `callbackURL` that never passed that check in the first place

If `set-ott` is absent — an OAuth failure redirect, which establishes no new session — the hook
does nothing, so no token is ever appended to an error URL. The client exchanges the token at
`POST /api/auth/one-time-token/verify` and reads `set-auth-token` from the response.

Ordering matters: Better Auth runs plugin hooks in array order, so `oidcTokenRedirect` must be
registered _after_ `oneTimeToken`, whose own after-hook is what writes the `set-ott` header the
hook reads. Reversed, there is no header to read, so the redirect silently carries no token and
sign-in fails with no error anywhere.

`oneTimeToken` also sets `disableClientRequest: true`, which closes `GET
/api/auth/one-time-token/generate` — the client-facing endpoint that would otherwise let anyone with
a session cookie mint one of these tokens directly, and which nothing in Ryot's client calls. Only
requests carrying a real `c.request` are rejected, so the plugin's own internal minting (used by
`setOttHeaderOnNewSession` here, and by any direct `auth.api.generateOneTimeToken` call) is
unaffected.

This is the security property that motivated deleting the old `GET /api/oidc-handoff` route: there
is no longer any endpoint that mints a session-equivalent token from an ambient cookie outside a
genuine OAuth callback. Minting now happens only as a side effect of a callback that already
required a valid signed `state` cookie from a real, in-progress sign-in — there is nothing left to
navigate a signed-in victim to.

Accepted trade-off: on web, the one-time token is briefly visible in the address bar and browser
history, which a `postMessage`-based popup flow would have avoided. This is accepted because the
token is single-use, hashed at rest, expires in one minute, and the client route replaces the
history entry immediately after reading it — this was a considered choice, not an oversight.

The residual risk is platform-level, not application-level: a custom URL scheme like `ryot://` can
be claimed by another app installed on the same Android device, which could intercept the callback
redirect during a genuine sign-in. Verified Android App Links (and iOS Universal Links, which do not
share this weakness) are the hardening follow-up if that risk needs closing.

Web OIDC has one more requirement: the web client sends a relative `callbackURL`
(`/auth/callback`), and the final `Location` header carries it verbatim, so a browser resolves it
against whatever origin it is currently on when the OAuth callback redirects it — this server's own
origin, since that is where the whole round trip has been happening. That only reaches the web app
if this server is also the one serving it, i.e. `FRONTEND_URL` is genuinely this server's own public
URL (see below), not a separately hosted SPA pointed at this backend as its API. This was already a
requirement of the deleted handoff route, which sent the web target to `frontendUrl/auth/callback`
regardless of where the SPA was hosted; getting it wrong now fails the redirect instead of silently
landing the user on another host.

## Two-factor challenge

Better Auth carries the two-factor sign-in challenge only in a signed `two_factor` cookie: the
verify endpoints accept no equivalent in their body, and the `bearer` plugin converts the session
cookie alone. A portable bearer client cannot hold that cookie, so without a bridge every
2FA-enabled account would be unable to finish signing in on web or native.

`two-factor-bridge.ts` mirrors the bearer plugin for that one cookie. Its after-hook exposes the
already-signed cookie value as a `set-two-factor-token` response header; its before-hook accepts it
back on `/two-factor/*` as an `x-two-factor-token` request header and reinstates it as the cookie.
The value is passed through verbatim in both directions, so the server still does all the signing
and verification and the bridge adds no crypto of its own. The client holds the challenge in memory
for the duration of the sign-in attempt only - it is a short-lived mid-sign-in credential, not a
session, and never joins the session token in storage.

Ordering matters: Better Auth runs plugin hooks in array order, so the bridge must be registered
_after_ `twoFactor`, whose own after-hook is what writes the cookie the bridge reads.

## `FRONTEND_URL` must be the server's own public URL

better-auth's `baseURL` is set to `config.frontendUrl`, and it uses that value to build the
authorization redirect URI (`${baseURL}/callback/<provider>`) that brings the user back to this
server after the identity provider finishes. A relative `callbackURL` such as `/auth/callback` is
never resolved against `baseURL` by better-auth itself — it is carried through verbatim and lands in
the final `Location` header as-is, which is exactly why the browser needs to already be on this
server for it to resolve correctly (see "OIDC redirect" above). `FRONTEND_URL` is not "the URL users
see the app at" in the abstract; it must be the literal public URL of this server. Getting it wrong
doesn't fail loudly — it produces OIDC redirects to the wrong host, which is easy to misdiagnose as
an IdP misconfiguration.
