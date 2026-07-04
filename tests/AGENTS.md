# Tests Guidelines

This package contains end-to-end and integration-style tests for Ryot.

## Conventions

- Keep end-to-end suites in `tests/src/tests/<domain>/` folders that mirror backend modules; prefer descriptive filenames over `index.test.ts`.
- Prefer shared helpers in `tests/src/fixtures` for repeated auth setup, API setup, and test data builders.
- Favor fixture files with clear ownership (`auth`, `entity-schemas`, `events`, `media`, `query-engine`, `sandbox-provider`, `trackers`, `translations`) over generic catch-all helpers.
- Keep `tests/src/support` for cross-cutting test infrastructure (assertions, backend/container provisioning), not domain fixtures.
- Fake external HTTP endpoints with `startFakeHttpServer` (`support/fake-http-server.ts`): it serves on a random local port, records `{ path, body }` per request (body parsed as JSON, `null` when unparsable — the recorder consumes the body, so `respond` must not read it again), and answers with the `respond` callback (default `{ ok: true }`).
- Notification delivery assertions use the `startFakeAppriseServer` wrapper (`fixtures/notifications.ts`), which responds 500 to paths ending in `/fail` so delivery-failure behavior stays testable; Apprise POSTs land on `/notify/<key>`, so the platform `key` disambiguates platforms in the request log.
- Do not refactor `tests/src/seed-script.ts` as part of test fixture cleanup unless explicitly requested.
- Document how a test pattern or fixture works in this file, and how the backend behaves in `apps/app-backend/AGENTS.md`, rather than in scattered code comments. Keep inline comments to hyper-local notes that decode a single assertion (expected order, arithmetic) or justify a lint suppression.

## Hermetic Provider Tests

Every provider-driven test except the live smoke suite runs offline against a fake provider, so search/import/populate/translate/trending flows stay deterministic and make no external calls.

- `seedBuiltinProviderScript` (`fixtures/sandbox-provider.ts`) builds a complete SDK TypeScript provider module, compiles it through the authenticated script-creation API, then promotes that exact row through `testSupport.promoteSandboxScript`. Pair it with `cleanupBuiltinProviderScript` in `afterAll`/`afterEach`; the idempotent `testSupport.deleteSandboxScript` endpoint removes the script and its generated entities, relationships, and schema links without masking a test failure.
- Build fixed provider data with `fakeProviderSearchResult`, `fakeProviderDetailsResult`, and `fakeProviderTranslations`, then pass the results as `drivers` to `seedBuiltinProviderScript`. The values use public `@ryot/sandbox-sdk/provider` contracts and are serialized into one complete module; never concatenate driver registrations or place uncompiled source in an executable column.
- Link a script to an entity schema (`linkToEntitySchemaId` → `entity_schema_sandbox_script`) only when a `details` result references a related entity by the provider's slug, so it resolves as that schema's provider. Plain search/import (by `scriptId`) and provenance-based population need no schema link — the entity's own `sandbox_script_id` provenance selects the driver.
- A non-empty `translations` fixture always defines the provider's `translate` driver: it returns a fixed overlay for each named language and an empty object (an all-null negative-cache overlay) for any other. Include it even in "must not translate" cases so an erroneous premature translate writes a detectable all-null overlay instead of erroring out.
- Provider metadata carries `providerInformation.canonicalLanguage`, which the backend read path uses to compute `translationStatus` (semantics owned by `apps/app-backend/src/modules/entity-interest/AGENTS.md`).
- When one provider owns a relationship into another provider's entities, clean up sequentially, owner first (for example, `entity-schemas/search-import.test.ts` cleans the anime provider before the linked company provider).

## Test-Support Seeding

Admin-only fixture operations use the typed `testSupport` contract group with `adminHeaders` from `fixtures/admin.ts`. Manual SQL is reserved for special cases that assert internal database state no HTTP endpoint should expose.

- `seedGlobalShowEpisodeTree` and `seedMediaEntity` use `createGlobalEntity` and `upsertGlobalRelationship`; user-scoped entities continue through the authenticated entities API.
- `getBuiltinEntitySchemaId` uses `getBuiltinEntitySchema` for structural schemas that tracker-scoped listing cannot see.
- Translation fixtures use `setEntityPopulatedAt`, `upsertEntityTranslation`, and `listEntityTranslations`; null overlay values model a negative cache.
- Mixed-auth fixtures use `linkAuthAccount`, while sandbox fault injection uses `patchSandboxScript` only after compiling executable code through the public sandbox API.

The SQL allowlist is workflow polling through `cluster_messages`/`cluster_replies`. Document any new SQL exception here; otherwise use the contract API.

## SSE Interest Streams

- `openInterestStream` (`fixtures/interest-sse.ts`) opens an authenticated SSE interest stream (auth via the `Cookie` header), collects `entity:updated` frames, and exposes `declareInterest`, `waitForEntityUpdated`, and `expectNoEntityUpdated`. `declareInterest` POSTs the interest set for the stream and returns any immediate terminal catch-up frames from the response body. The SSE parser ignores comment lines such as the `: ping` heartbeat.
- Reads never trigger fills; declaring interest does — protocol and invariants owned by `apps/app-backend/src/modules/entity-interest/AGENTS.md`.

## OIDC Sign-In Flow

`oidcSignIn` (`fixtures/auth-oidc.ts`) drives the full Better Auth OIDC handshake in three steps: (1) POST `/auth/sign-in/oauth2` returns `{ url }` and sets a state cookie; (2) POST that authorize URL to the mock OIDC server with a username (`mock-oauth2-server` auto-approves any posted username) and read the callback URL from the `location` header; (3) GET the backend callback with the state cookie, at which point Better Auth exchanges the code, creates/looks up the user, and sets the session cookie.

## Live Provider Smoke Tests

`tests/src/tests/smoke/providers-live-smoke.test.ts` is the only suite that makes real external HTTP calls; it is gated behind `RUN_LIVE_PROVIDER_TESTS` (`=1`/`true`) so PR CI stays fast and deterministic. Run it in a nightly/pre-release job as an early-warning signal for upstream drift — provider schema changes, endpoint moves, and auth/credential failures a fully-mocked test can never surface.

Coverage is intentionally minimal (a drift signal, not exhaustive): OpenLibrary book search → import (keyless) and TMDB movie translate-on-interest (requires `providers.tmdbAccessToken`, else the translate never completes and the test times out). It imports the first real search result by its own `externalId` (never a hardcoded provider id format) and asserts the localized overlay differs from the canonical name and is non-empty rather than an exact string, since upstream copy can drift.

## Query-Engine Parity

`sql-pushdown.test.ts` asserts that aggregates/time-series over a filtered source, relationship-root filtering, and correlated exists/aggregate return the same results whether they run pushed down in SQL or app-side.

## Query-Engine Construction

- Build valid query documents with `@ryot/query-engine`; `fixtures/query-engine-core.ts` owns execution and response assertions, not a second query-document DSL.
- Use named Ryot recipes for entity/event reads, media hierarchy and discovery, fitness lists, relationships, and saved-view defaults. Keep test-specific course hierarchies and deliberately malformed fragments explicit.
- Sandbox-script source strings cannot import TypeScript utilities; keep their embedded query documents local to the sandbox tests.

## Diagnosing Failures

- Assert async job completion with `assertCompleted` (`support/assertions.ts`) rather than comparing `result.status` by hand. For successful sandbox executions, use `requireCompletedSandboxValue`; failures render the structured phase, source location, message, and sanitized stack instead of collapsing the error to a string.
- Every backend the harness spawns gets a unique `SERVER_LOG_FILE` (set by `buildBackendEnv`) under the OS temp dir, and the harness prints the path at startup.

## Observability

`tests/src/tests/system/observability.test.ts` uses an isolated backend and a local OTLP JSON receiver so tracing does not add load or timing noise to the shared E2E backend. It triggers one authenticated notification-delivery workflow, joins the exported workflow span to its completion log through `traceId` and `spanId`, and joins the request span to its HTTP response log through `traceId` and `userId`; do not broaden it into assertions over Effect's batching, generated identifier formats, or nested spans.

## Timeouts & Pool Sizing

- Inner poll budgets (event waits in `fixtures/events.ts`, sandbox polls in `fixtures/sandbox.ts`) are sized generously and kept comfortably below the outer 180s per-test timeout (`package.json`), so a genuine hang still fails. Automation and sandbox results flow through the durable-queue pipeline, whose p99 latency spikes under full-suite load — that's what the headroom is for.
- `DATABASE_WORKFLOW_POOL_MAX` (`support/provisioning.ts`) must exceed `SANDBOX_WORKER_CONCURRENCY` plus headroom: the cluster `SingleRunner` permanently reserves one connection even though advisory shard locks are disabled, so usable connections = max − 1. Starving this pool manifests as random cross-cutting timeouts, not an obvious pool-exhaustion error. The Postgres container's `max_connections` must in turn cover the app pool, the workflow pool, and the harness pool combined.

## Isolation

Parallel test runs share one backend, so keep fixtures collision-free: use randomized external ids (e.g. the random TMDB id in `seedGlobalShowEpisodeTree`) and a unique schema slug per user when two users must exercise the same schema shape (in production each user has their own schema anyway).

## Media Monitoring

`tests/src/tests/media-monitoring/media-monitoring.test.ts` seeds an API-compiled offline details provider, then exercises status/enable/disable through the typed contract client. Its cron case compiles replacement source through the API before copying the complete representation to the promoted provider, and uses the real admin infrequent-cron trigger plus a local Apprise server so baseline silence, provider refresh, signal production, subscription audience resolution, and notification delivery are covered together. `fixtures/media-monitoring.ts` owns the endpoint wrappers, the relationship-root query assertion, and `waitForMediaMonitoringRefresh` (polls `cluster_messages`/`cluster_replies` for a refresh execution's completion — shared by every suite that forces a re-population through `enableMediaMonitoring` + `triggerInfrequentCron`, since `entityImport.import` is ensure-mode and no-ops on an already-populated entity).

Association detector suites live in `tests/src/tests/media-monitoring/association-detectors*.test.ts` and `media-entity-update-signals.test.ts`. Credit edges have two writers (a media-rooted additive incoming sync and a person/company-rooted authoritative outgoing sync); the shared cron-refresh mechanism above is how a test re-drives an already-populated root to exercise role updates, authoritative deletes, and re-creates from either direction.
