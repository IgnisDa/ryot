# MCP

`/api/mcp` serves Streamable HTTP through `effect/ai`'s `McpServer.layerHttp`. It supports
sessionless 2026-07-28 and sessionful 2025-11-25, 2025-06-18 and 2025-03-26 clients. The endpoint
accepts `X-Api-Key` and OAuth Bearer credentials, with the MCP resource as the required audience.
Hosted cookies alone cannot authenticate tool requests. Missing or invalid credentials receive a
401 challenge pointing to `/.well-known/oauth-protected-resource/api/mcp`.

Every HTTP request resolves the authoritative credential before accessing transport state, and the
registry authenticates calls again. Each connection registers the fixed
[agent tools](../agent-tools/README.md) once, with their read-only, destructive and idempotent
annotations; installed plugins never change the tool list. Calls retain the registry's bounded
result envelope. Demo filtering and operation admission/lifecycle restrictions remain
registry/service responsibilities.

The MCP write gate approves every `execute` write, because the client approves the `execute` call
itself. Adding `?readonly=true` to the endpoint URL makes a separate connection whose gate declines
writes and which omits `page_write` and `page_publish`; it can only narrow the credential's access.

Each authorization identity (user, access class, credential and originating OAuth session) and
read-only mode owns a separate Effect MCP server and session store. Request headers reach handlers through MCP middleware;
they are never captured from initialization. Another identity's session ID is unknown, and revoked
or disabled credentials cannot reuse retained sessions. The scoped cache holds up to 1,024 identities
for 30 minutes. A scope-owned sweep closes expired servers within one further minute, including
abandoned or revoked identities; eviction and shutdown also close their resources. Clients then
initialize again. MCP subscriptions are disabled. Tool calls, cancellation and session termination
run concurrently.

Origins, when supplied, must match the configured frontend origin. Origin-less native clients are
accepted. Server reachability, HTTPS and tunnels are operator responsibilities. The auth module owns
resource provisioning, public registration, discovery aliases and hosted consent.

Transport tests exercise authentication challenges, tool annotations, registry delegation, the
write gate and read-only mode, disabled credentials and cross-user session isolation. Focused API e2e covers API
keys, OAuth registration and consent, resource audience separation, discovery and real registry
list/call. These tests do not establish compatibility with Claude Desktop or another installed client;
those require actual client runs against a reachable deployment.
