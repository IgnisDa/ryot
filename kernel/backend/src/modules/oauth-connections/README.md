# OAuth Connections

This module links an external account to an integration settings field through a kernel-managed
OAuth authorization code flow. A provider declares `pkce: "S256"` or explicitly opts out with
`pkce: "none"`; state validation remains required in both modes. A system plugin declares
`oauthProviders` and marks a top-level integration `settingsSchema` string with
`format: { kind: "oauth-connection", provider }`.
The field value is an opaque connection id; tokens never enter integration settings.

## Flow

1. `POST /oauth-connections` resolves the integration provider for the caller (or the exact
   installation of `integrationId`), reads the provider's client ID and secret from the plugin
   configuration keys it names, and stores a pending connection for ten minutes. Integrations marked
   `requiresProKey` can start only when the server has a validated Pro key. The response carries the
   connection id and the provider authorization URL.
2. The provider redirects to the callback registered for that plugin and provider. The callback is
   public. It consumes the pending state only on its own provider path, stores the encrypted code,
   issues a one-time completion secret, and redirects to `settings/oauth-return` (web) or
   `<applicationId>:/settings/oauth-return` (native) with `connection` and `secret` in the fragment.
   Failures redirect with `status=failed`. Responses are `no-store` and `no-referrer`; the callback
   never exchanges the code and never echoes provider parameters.
3. `POST /oauth-connections/:id/complete` requires the connection owner's credentials and the
   completion secret. It exchanges the code outside any transaction and stores the tokens. Access-token
   expiry uses the token response's `expires_in`, then the provider's optional
   `accessTokenLifetimeSeconds`, then the existing 3600-second default. An unbound connected
   connection expires after one hour.
4. Creating or updating an integration binds the connection with one conditional update inside the
   integration write transaction: same user, installation, integration provider, and field, status
   `connected`, and not bound elsewhere. Replacing a connection deletes the previous one. Database
   constraints tie a bound connection to its integration's user, installation, and provider, and allow
   one connection per integration field.
5. `getOAuthAccessToken({ field })` is available only to a user-subject execution carrying both the
   integration and the currently running integration run, from the integration's own plugin and
   installation, for a field its current settings schema declares. Access tokens within 60 seconds of
   expiry are refreshed under a lease with a compare-and-set on the token version; the token request
   runs outside transactions. A rejected refresh grant expires the connection, and later calls fail
   with "OAuth connection expired; reconnect the integration". The connection ID comes from the run's
   admitted settings, so a reconnect cannot switch an active run to another account; token refresh
   remains live for that same connection.
   `invalidateOAuthAccessToken({ field, accessToken })` has the same run and field scope. It expires the
   bound connection only when the supplied token matches its current decrypted token and the
   connection-id, token-version, and integration-id compare-and-set succeeds. A stale token is a
   successful no-op, so a token from before reconnect cannot expire its replacement. It returns `null`.

A connection without a refresh token is not refreshed. It expires when the access token enters the
60-second refresh window, and the user must reconnect it.

`GET /oauth-connections/:id` reports `pending`, `authorized`, `connected`, `failed`, or `expired` to
the owner and returns 404 to anyone else. The frequent cron deletes expired unbound connections.

## Secrets

Codes, PKCE verifiers, access tokens, and refresh tokens are encrypted with an HKDF subkey of the
plugin configuration key (`ryot/oauth-connection/token`), bound to the connection, user, and column.
State and completion secrets are stored as SHA-256 hashes. Refresh tokens, client secrets, codes, and
verifiers never appear in responses, logs, spans, or errors; HTTP tracing is disabled for the callback
path. Token requests are HTTPS-only, never follow redirects, time out after ten seconds, cap responses
at 64 KiB, and report only kernel error codes. A refresh is refused when the manifest token URL origin
differs from the origin recorded when the connection was created.

Access tokens returned to a script are recorded in the sandbox workflow journal, like any other host
call result.

Backups drop OAuth connection settings and restore those integrations disabled; the user reconnects
them.

## Provider Registration

Register exactly `<FRONTEND_URL>/api/oauth-connections/providers/<pluginSlug>/<oauthProviderSlug>/callback`
as the provider redirect URI. Providers such as Spotify require an exact match and accept only HTTPS
or loopback `http://127.0.0.1` and `http://[::1]` redirect URIs, so `FRONTEND_URL` must use one of
those forms.

A provider that rejects a refresh surfaces as a failed integration run. Leave
`disableOnContinuousErrors` off for OAuth-backed integrations unless repeated failures should disable
the integration until the user reconnects it.
