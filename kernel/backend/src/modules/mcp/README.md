# MCP

`/api/mcp` serves Streamable HTTP through `effect/ai`'s `McpServer.layerHttp`. It supports
sessionless 2026-07-28 and sessionful 2025-11-25, 2025-06-18 and 2025-03-26 clients. The endpoint
accepts `X-Api-Key` and OAuth Bearer credentials, with the MCP resource as the required audience.
Hosted cookies alone cannot authenticate tool requests. Missing or invalid credentials receive a
401 challenge pointing to `/.well-known/oauth-protected-resource/api/mcp`.

Every HTTP request resolves the authoritative credential before accessing transport state, and the
registry authenticates calls again. Each connection registers the fixed
[agent tools](../agent-tools/README.md) once, with the tool list and annotations the credential's write access allows;
installed plugins never change the tool list. Calls retain the registry's bounded
result envelope. Demo filtering and operation admission/lifecycle restrictions remain
registry/service responsibilities.

Write access comes from the credential (see the auth README); the endpoint has no connection-level
modes. Clients that declare form elicitation get a confirmation gate, so `confirm` credentials can
write: sessionful protocols send an `elicitation/create` request inline, and 2026-07-28 returns
`InputRequired` keyed `write-<host call index>` (or `call` for `page_publish`) with an opaque
`requestState`. The client's retry carries that state; `execute` runs under the idempotency key
`mcp:<requestState>`, so the agent script journal replays settled calls and resumes at the write with
the client's answer. Only `accept` approves. Clients without elicitation cannot write with `confirm`
access.

Each authorization identity (user, access class, write access, credential and originating OAuth
session) owns a separate Effect MCP server and session store. Request headers reach handlers through MCP middleware;
they are never captured from initialization. Another identity's session ID is unknown, and revoked
or disabled credentials cannot reuse retained sessions. The scoped cache holds up to 1,024 identities
for 30 minutes. A scope-owned sweep closes expired servers within one further minute, including
abandoned or revoked identities; eviction and shutdown also close their resources. Clients then
initialize again. MCP subscriptions are disabled. Tool calls, cancellation and session termination
run concurrently.

Origins, when supplied, must match the configured frontend origin. Origin-less native clients are
accepted. Server reachability, HTTPS and tunnels are operator responsibilities. The auth module owns
resource provisioning, public registration, discovery aliases and hosted consent.

Transport tests exercise authentication challenges, write-access tool lists and annotations,
registry delegation, sessionful and 2026-07-28 confirmation, disabled credentials and cross-user
session isolation. Focused API e2e covers API keys, OAuth registration and consent, access-scope
narrowing, resource audience separation, discovery, real registry list/call and connected-app
revocation. These tests do not establish compatibility with any installed client.

## Client verification

Before a beta release, connect each client below to a deployment it can reach over HTTPS (hosted
clients cannot reach a LAN address; use a tunnel or a staging server) and record the Ryot version,
client version and result here. For each client:

1. Add `<FRONTEND_URL>/api/mcp` with no credentials and complete OAuth discovery, registration and
   consent. Confirm the consent page offers the access levels and the token carries the chosen scopes.
2. Run a read (`search`, then `execute` calling `kernel:collections.list`) and confirm the client
   does not prompt for approval of reads.
3. With **Ask before each change**, run an `execute` that creates a collection. Confirm the client
   shows Ryot's confirmation, that declining leaves no collection, and that accepting creates exactly
   one. If the client cannot show confirmations, confirm Ryot refuses the write with the reconnect
   message.
4. With **Read only**, confirm the same write is refused and `page_write` is absent.
5. Revoke the app in Settings → Access and confirm the next call, after the access token expires,
   fails authentication and the client prompts to reconnect.
6. Repeat 2 and 3 with an API key in `X-Api-Key` where the client supports custom headers.

Clients: Claude Desktop or claude.ai, ChatGPT, Cursor, Claude Code. Record which protocol version each
negotiates, because sessionful clients use inline elicitation and 2026-07-28 clients use input
requests.
