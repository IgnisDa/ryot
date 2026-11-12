# MCP

`/api/mcp` serves Streamable HTTP through `effect/ai`'s `McpServer.layerHttp`. It supports
sessionless 2026-07-28 and sessionful 2025-11-25, 2025-06-18 and 2025-03-26 clients. The endpoint
accepts `X-Api-Key` and OAuth Bearer credentials, with the MCP resource as the required audience.
Hosted cookies alone cannot authenticate tool requests. Missing or invalid credentials receive a
401 challenge pointing to `/.well-known/oauth-protected-resource/api/mcp`.

Every HTTP request resolves the authoritative credential before accessing transport state, and the
registry authenticates discovery and calls again. Tool descriptors come from `AgentToolsService`,
including manifest descriptions, input schemas and read-only, destructive and idempotent annotations.
Calls retain the registry's bounded result envelope and pin the discovered source revision. Demo
filtering and operation admission/lifecycle restrictions remain registry/service responsibilities.

Each authorization identity (user, access class, credential and originating OAuth session) owns a
separate Effect MCP server and session store. Request headers reach handlers through MCP middleware;
they are never captured from initialization. Another identity's session ID is unknown, and revoked
or disabled credentials cannot reuse retained sessions. The scoped cache holds up to 1,024 identities
for 30 minutes. A scope-owned sweep closes expired servers within one further minute, including
abandoned or revoked identities; eviction and shutdown also close their resources. Clients then
initialize again. Discovery refreshes the effective catalog before each request,
replaces changed descriptors and hides removed tools. MCP subscriptions are disabled.
Only registry refresh is serialized; tool calls, cancellation and session termination run concurrently.

Origins, when supplied, must match the configured frontend origin. Origin-less native clients are
accepted. Server reachability, HTTPS and tunnels are operator responsibilities. The auth module owns
resource provisioning, public registration, discovery aliases and hosted consent.

Transport tests exercise authentication challenges, manifest annotations, registry delegation,
catalog refresh, disabled credentials and cross-user session isolation. Focused API e2e covers API
keys, OAuth registration and consent, resource audience separation, discovery and real registry
list/call. These tests do not establish compatibility with Claude Desktop or another installed client;
those require actual client runs against a reachable deployment.

Handlers send the full registry descriptor fingerprint back with each call, alongside existing
source pins. Changed descriptions, schemas, hints or source identities therefore invalidate a
retained handler. Static `run_script` annotations remain write/destructive; the assistant registry
separately computes effective hints only after validating the specific invocation arguments.
