## Problem Statement

Ryot's sandbox system currently exposes only a narrow set of backend capabilities through dedicated host functions such as `executeQuery`. That model does not scale well. Every new backend capability would require a new sandbox-specific host function, duplicated validation, duplicated integration logic, and duplicated tests.

The current permission model is also too permissive. Scripts without explicit metadata can expand to all registered host functions, which makes `allowedHostFunctions` less authoritative than it should be. In addition, sandbox script metadata is nullable in storage, which makes permission handling less explicit and less predictable.

The result is a sandbox system that is harder to extend, harder to reason about, and weaker than it should be from a capability-control perspective.

## Solution

Replace the specialized `executeQuery` host function with a general-purpose host function named `appApiCall`. This host function will execute authenticated in-process requests against the backend route surface mounted on `baseApp` in `apps/app-backend/src/app/api.ts`.

The sandbox will continue to use `allowedHostFunctions` as the sole authority for what a script can call. Scripts without an explicit allowlist will receive no host-function access. Sandbox script metadata will become mandatory in API writes and non-null in storage.

Authenticated sandbox API calls will be executed safely inside the backend process without passing cookies, API keys, session tokens, or any other reusable credentials into sandbox code.

## User Stories

1. As a Ryot developer, I want sandbox scripts to call backend API routes through one general-purpose host function, so that new backend capabilities do not require new sandbox-specific host functions.
2. As a Ryot developer, I want sandbox API calls to reuse the real backend route layer, so that validation, auth, and response behavior stay consistent with the main application.
3. As a Ryot developer, I want `executeQuery` removed completely, so that the sandbox capability surface is simpler and less redundant.
4. As a Ryot developer, I want `appApiCall` to target any route mounted on `baseApp`, so that sandbox scripts can use the full app-owned backend surface.
5. As a Ryot developer, I want raw Better Auth handler routes under `/api/auth/*` excluded, so that sandbox API access stays scoped to the app-owned API surface.
6. As a Ryot developer, I want sandbox API calls to run as the owning user, so that authorization behavior matches normal user execution.
7. As a Ryot developer, I do not want cookies, API keys, or bearer tokens passed into sandbox code, so that sandbox scripts cannot exfiltrate reusable credentials.
8. As a Ryot developer, I want internal sandbox API auth to be non-spoofable by public callers, so that internal route execution does not create a new external credential surface.
9. As a Ryot developer, I want internal sandbox API auth to work entirely in-process, so that same-process execution does not require Redis token plumbing.
10. As a Ryot developer, I want `allowedHostFunctions` to be fully authoritative, so that a script only gets the host functions it explicitly declares.
11. As a Ryot developer, I want scripts without `allowedHostFunctions` to receive no host functions, so that permissions are opt-in instead of opt-out.
12. As a Ryot developer, I want invalid sandbox metadata to fail execution early, so that bad configuration cannot silently expand capabilities.
13. As a Ryot developer, I want sandbox script metadata to be mandatory and non-null in storage, so that permission handling always has a concrete metadata object to evaluate.
14. As a user creating sandbox scripts, I want the create-script API to accept metadata, so that I can explicitly grant a script access to `appApiCall` or other allowed host functions.
15. As a user creating sandbox scripts, I want omitted metadata to default to an empty object, so that storage stays consistent without forcing clients to send an empty payload manually.
16. As a user creating sandbox scripts, I want omitted `allowedHostFunctions` to mean no host functions, so that permissions stay safe by default.
17. As a maintainer of builtin sandbox scripts, I want existing builtin allowlists to remain unchanged, so that builtin scripts do not accidentally gain access to `appApiCall`.
18. As a Ryot developer, I want `appApiCall` to normalize `/foo` and `/api/foo`, so that scripts can target routes consistently.
19. As a Ryot developer, I want `appApiCall` to reject auth override headers such as `authorization`, `cookie`, and `x-api-key`, so that scripts cannot interfere with the internal auth model.
20. As a Ryot developer, I want `appApiCall` to return structured success and failure results, so that sandbox scripts can inspect response status, headers, and body consistently.
21. As a Ryot developer, I want JSON responses to be parsed as JSON and non-JSON responses to be returned as text, so that scripts can consume backend routes predictably.
22. As a Ryot developer, I want unknown host-function names in metadata to fail before sandbox code runs, so that configuration errors are visible immediately.
23. As a Ryot developer, I want backend unit tests for `appApiCall`, auth bridging, and permission resolution, so that behavior is verified at the module boundary rather than by implementation details.
24. As a Ryot developer, I want end-to-end tests for sandbox API calling and permission enforcement, so that the full route, auth, and sandbox integration is verified.

## Implementation Decisions

- `executeQuery` will be deleted completely. No backward-compatibility alias or shim will be added.
- A new host function named `appApiCall` will be added with the interface `appApiCall(method, path, options?)`.
- `appApiCall` will execute in-process requests against the backend route surface mounted on `baseApp`.
- `appApiCall` will not target raw Better Auth handler routes under `/api/auth/*`.
- Internal sandbox auth for `appApiCall` will use an in-memory `WeakMap<Request, { userId: string }>`.
- Internal sandbox auth will not use Redis, request headers, cookies, query params, or any request-visible bearer token.
- The auth middleware will first check the in-memory internal request registry, resolve the user from the database when present, and otherwise fall back to the normal Better Auth session flow.
- External requests will continue to set both user and session. Internal sandbox requests only require user resolution. If route typing currently requires session, typing will be relaxed or the session value will be set to `null`.
- `appApiCall` will validate `context.userId`, request method, and request path before execution.
- `appApiCall` will normalize `/foo` and `/api/foo` to the same base-app-relative route.
- `appApiCall` will reject auth override headers such as `authorization`, `cookie`, and `x-api-key`.
- `appApiCall` will serialize request bodies as JSON when a body is present.
- `appApiCall` will return structured success and failure results that include response status, headers, and body.
- JSON responses will be returned as parsed JSON values. Non-JSON responses will be returned as text.
- Sandbox permission resolution will change from default-all to default-none.
- `metadata` will be required for sandbox execution and must parse successfully with `sandboxScriptMetadataSchema`.
- Missing `allowedHostFunctions` will mean zero host functions.
- An empty `allowedHostFunctions` array will mean zero host functions.
- Populated `allowedHostFunctions` will grant exactly those host functions.
- Unknown host-function names will fail execution before sandbox code runs.
- The `sandbox_script.metadata` column will become `NOT NULL`.
- Existing `NULL` metadata rows will be backfilled to an empty JSON object before the `NOT NULL` constraint is applied.
- The create-sandbox-script contract will be extended to accept `metadata`.
- Omitted metadata on create will default to `{}`.
- Stored metadata will always be non-null.
- Builtin sandbox scripts will keep their current explicit allowlists and will not be granted `appApiCall` unless explicitly changed later.
- The main deep modules introduced or clarified by this work are: an app-level internal request executor, an app-level internal auth registry, and the sandbox host-function permission resolver.

## Testing Decisions

- Good tests for this work should assert observable behavior at the module and route boundary, not implementation details such as private helper structure or the exact internal storage of intermediate values.
- `appApiCall` should have backend unit tests covering validation failures, auth-header rejection, path normalization, JSON and non-JSON response mapping, and non-2xx response handling.
- The sandbox service permission resolver should have unit tests covering explicit allowlists, missing allowlists, invalid metadata, unknown host-function names, and user-context binding for `appApiCall`.
- The auth middleware and internal request bridge should have tests covering successful user resolution for internal requests, missing-user failure, fallback to the normal auth path for untagged requests, and protection against public spoofing through request headers.
- End-to-end sandbox tests should cover successful `appApiCall` usage, failure on missing schema inputs through the query-engine route, denial for scripts without metadata-based permission, successful access for scripts explicitly granted `appApiCall`, and confirmation that `/api/auth/*` remains out of scope.
- Builtin-script behavior should be covered so that existing builtin providers do not accidentally gain `appApiCall`.
- Similar prior art exists in the current sandbox unit tests, function registry tests, sandbox service tests, and the sandbox end-to-end test suite.

## Out of Scope

- Raw Better Auth handler routes under `/api/auth/*`
- Backward compatibility for `executeQuery`
- Compatibility behavior for old nullable metadata semantics beyond the one-time database backfill needed to apply `NOT NULL`
- A second permission layer that filters which backend paths `appApiCall` may access beyond the existing `baseApp` scope and `allowedHostFunctions`
- Changes to builtin script allowlists other than preserving their current behavior

## Further Notes

- The internal request executor and internal auth registry should live outside the sandbox module to avoid circular imports through the sandbox API module.
- This work should keep the sandbox bridge focused on sandbox-to-host RPC, while moving app-route execution into a dedicated app-level module.
- The create-script API change is necessary because default-none permissions would otherwise leave user-created scripts with no supported way to gain host-function access later.
- Because this work changes backend auth and route execution, it should receive focused backend review after implementation and test verification.

---

## Tasks

**Overall Progress:** 2 of 2 tasks completed

**Current Task:** None

### Task List

| #   | Task                                                                   | Type | Status |
| --- | ---------------------------------------------------------------------- | ---- | ------ |
| 01  | [Add `appApiCall` End-to-End](./01-add-app-api-call-end-to-end.md)     | AFK  | done   |
| 02  | [Harden Sandbox Permissions And Metadata](./02-harden-sandbox-permissions-and-metadata.md) | AFK  | done   |
