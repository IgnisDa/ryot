# Tests Guidelines

This package contains end-to-end and integration-style tests for Ryot.

## Conventions

- Keep end-to-end suites in `tests/src/tests/<domain>/` folders that mirror backend modules; prefer descriptive filenames over `index.test.ts`.
- Prefer shared helpers in `tests/src/fixtures` for repeated auth setup, API setup, and test data builders.
- Favor fixture files with clear ownership (`auth`, `entity-schemas`, `events`, `media`, `query-engine`, `sandbox-provider`, `translations`) over generic catch-all helpers.
- Keep `tests/src/support` for cross-cutting test infrastructure (assertions, backend/container provisioning), not domain fixtures.
- Fake external HTTP endpoints with `startFakeHttpServer` (`support/fake-http-server.ts`): it serves on a random local port, records `{ path, body }` per request (body parsed as JSON, `null` when unparsable — the recorder consumes the body, so `respond` must not read it again), and answers with the `respond` callback (default `{ ok: true }`).
- Notification delivery assertions use the `startFakeAppriseServer` wrapper (`fixtures/notifications.ts`), which responds 500 to paths ending in `/fail` so delivery-failure behavior stays testable; Apprise POSTs land on `/notify/<key>`, so the platform `key` disambiguates platforms in the request log.
- Do not refactor `tests/src/seed-script.ts` as part of test fixture cleanup unless explicitly requested.
- Document how a test pattern or fixture works in this file, and how the backend behaves in `apps/app-backend/AGENTS.md`, rather than in scattered code comments. Keep inline comments to hyper-local notes that decode a single assertion (expected order, arithmetic) or justify a lint suppression.

## Runner & Effect Conventions

- The suite runs on vitest-on-bun: `bun turbo --filter=@ryot/tests test`. `vitest.config.ts` owns the config — up to three files run in parallel against one shared backend, `testTimeout`/`hookTimeout` are 180s, the `~/` → `src/` alias is configured there, and the `hanging-process` reporter is enabled. Keep worker capacity conservative so durable background work from earlier files cannot outpace the backend, containers, and Deno workers.
- `global-setup.ts` provisions the containers and one shared backend once per run and `provide`s `backendUrl`; test code reads it via `inject` through `support/backend.ts`. `test-setup.ts` registers `addEqualityTesters`. Workers cannot import globalSetup state, so shared handles cross this `provide`/`inject` seam.
- Import the runner surface only from `~/support/effect-test` (`describe`, `expect`, `assert`, `it`, `beforeAll`, `afterAll`); oxlint bans importing `bun:test`/`vitest`/`@effect/vitest` under `src/tests/**`. Test bodies are `Effect.gen` under `it.live` (no resources) or `it.scopedLive` (per-test `Effect.acquireRelease` resources). `it.effect` is deliberately withheld — it installs Effect's `TestClock`, which deadlocks the real-time waits these E2E suites depend on. `view-language/parse-field-path.test.ts` is a pure unit test and uses plain `it`.
- Fixtures are Effect-native. `makeSession(...).call(program, headers?)` returns `Effect<A, E>`; assert an expected failure with `yield* Effect.flip(client.call(...))`. `pollUntil(label, check: Effect<A | null>, opts)` retries `check` until non-null (fails with the tagged `PollTimeout`). Resource fixtures expose scoped acquire-release variants for `it.scopedLive`: `openInterestStreamScoped`, `startFakeAppriseServerScoped`, `startFakeHttpServerScoped` — they auto-close at test end, so no manual `stop()`/`close()`/`afterEach`.
- `beforeAll`/`afterAll` stay plain async hooks (vitest owns their lifecycle); run Effect fixtures inside them via `Effect.runPromise`. Raw `fetch`, `response.json()`, `postBackendJson`, and other Promise-returning boundary helpers are wrapped with `Effect.promise(() => ...)` inside Effect bodies.
- `tsconfig.json` enables the `@effect/language-service` plugin (diagnostics run during `tsc`). Enforced as errors: `globalDateInEffect`, `processEnvInEffect`, `globalTimersInEffect`, `globalConsoleInEffect`, `globalErrorInEffectFailure`. Disabled because the harness legitimately needs them: `asyncFunction` (vitest hooks, Promise-boundary fixtures, seed-script), `nodeBuiltinImport` (spawning backends, temp dirs, log reads), `globalFetchInEffect` (raw HTTP to non-contract endpoints), `preferSchemaOverJson` (sandbox source strings, response comparisons), `newPromise` (the SSE listener bridges in `fixtures/interest-sse.ts`).

## Hermetic Provider Tests

Every provider-driven test except the live smoke suite runs offline against a fake provider, so search/import/populate/translate/trending flows stay deterministic and make no external calls.

- `installTestProvider` (`fixtures/sandbox-provider.ts`) builds a complete SDK TypeScript provider module and installs it through the real admin plugins endpoint. Pair it with `uninstallTestProvider`; uninstall is best-effort because the production lifecycle correctly refuses to remove plugins while generated entities still reference their schemas or scripts.
- Build fixed provider data with `fakeProviderSearchResult`, `fakeProviderDetailsResult`, and `fakeProviderTranslations`, then pass the results to `installTestProvider` as its per-operation `details`, `search`, `resolve`, and `translations` inputs. The values use public `@ryot/sandbox-sdk/provider` contracts and each operation is emitted as its own complete single-definition module; never place uncompiled source in an executable column.
- Link an installed fixture script to an entity schema (via `linkToEntitySchemaSlug`) only when a `details` result references a related entity by the provider's slug. Links come from the test plugin manifest's real `bindings.schemaProviderLinks`. Plain search/import addresses the script directly by its script id, and provenance-based population resolves the provider from the entity's `provider_id`, so neither needs a schema link.
- A non-empty `translations` fixture always defines the provider's `translate` operation: it returns a fixed overlay for each named language and an empty object (an all-null negative-cache overlay) for any other. Include it even in "must not translate" cases so an erroneous premature translate writes a detectable all-null overlay instead of erroring out.
- Provider metadata carries `providerInformation.canonicalLanguage`, which the backend read path uses to compute `translationStatus` (semantics owned by `apps/app-backend/src/modules/entity-interest/AGENTS.md`).
- When one provider owns a relationship into another provider's entities, clean up sequentially, owner first (for example, `entity-schemas/search-import.test.ts` cleans the anime provider before the linked company provider).

## Test-Support Seeding

Admin-only fixture operations use the typed `testSupport` contract group with `adminHeaders` from `fixtures/admin.ts`.

- Sandbox execution coverage installs scripts with `installTestPlugin`, then uses the admin-gated `testSupport.enqueueSandbox` and `testSupport.getSandboxResult` hooks with an explicit executing-user ID. Use `reinstallTestPluginScript` to compile changed source and obtain its new content-addressed script ID before rerunning. Do not mutate stored script rows or add a public script-authoring or execution fixture.
- `plugins/operations.test.ts` covers the public `plugins.invoke` endpoint. It installs an `operation`-kind script from `operationSandboxSource` plus a manifest `operations` entry (`installTestPlugin`'s `operations` option) and calls the operation through the typed contract client, so dispatch, slug resolution, script input decoding, and the operation's declared `auth` mode are exercised against the real loader rather than the admin sandbox hooks.
- Entity, event, and relationship definition fixtures install scriptless plugins through the real admin plugins endpoint. Slugs and plugin slugs must be collision-free across the sequential run; definitions are persisted and visible as plugin workspaces.
- `seedGlobalShowEpisodeTree` and `seedMediaEntity` use `createGlobalEntity` and `upsertGlobalRelationship`; user-scoped entities continue through the authenticated entities API.
- `getBuiltinEntitySchemaSlug` uses `getBuiltinEntitySchema` for structural schemas outside plugin workspaces.
- Translation fixtures use `setEntityPopulatedAt`, `upsertEntityTranslation`, and `listEntityTranslations`; null overlay values model a negative cache.
- Mixed-auth fixtures use `linkAuthAccount`.
- Media-monitoring refresh waits use `setEntityInterest` to register an authenticated stream without reconciliation before targeting the `media/media-monitoring` plugin cron. This preserves cron-first population while synchronizing through the normal `entity:updated` event.

## SSE Interest Streams

- `openInterestStream` (`fixtures/interest-sse.ts`) opens an authenticated SSE interest stream (auth via the `Cookie` header), collects `entity:updated` frames, and exposes `declareInterest`, `waitForEntityUpdated`, and `expectNoEntityUpdated`. `declareInterest` POSTs the interest set for the stream and returns any immediate terminal catch-up frames from the response body. The SSE parser ignores comment lines such as the `: ping` heartbeat.
- Reads never trigger fills; declaring interest does — protocol and invariants owned by `apps/app-backend/src/modules/entity-interest/AGENTS.md`.

## OIDC Sign-In Flow

`oidcSignIn` (`fixtures/auth-oidc.ts`) drives the full Better Auth OIDC handshake in three steps: (1) POST `/auth/sign-in/oauth2` returns `{ url }` and sets a state cookie; (2) POST that authorize URL to the mock OIDC server with a username (`mock-oauth2-server` auto-approves any posted username) and read the callback URL from the `location` header; (3) GET the backend callback with the state cookie, at which point Better Auth exchanges the code, creates/looks up the user, and sets the session cookie.

## Live Provider Smoke Tests

`tests/src/tests/smoke/providers-live-smoke.test.ts` is the only suite that makes real external HTTP calls; it is gated behind `RUN_LIVE_PROVIDER_TESTS` (`=1`/`true`) so PR CI stays fast and deterministic. Run it in a nightly/pre-release job as an early-warning signal for upstream drift — provider schema changes, endpoint moves, and auth/credential failures a fully-mocked test can never surface.

Coverage is intentionally minimal (a drift signal, not exhaustive): OpenLibrary book search → import (keyless) and TMDB movie translate-on-interest (requires `providers.tmdbAccessToken`, else the translate never completes and the test times out). It imports the first real search result by its own `externalId` (never a hardcoded provider id format) and asserts the localized overlay differs from the canonical name and is non-empty rather than an exact string, since upstream copy can drift.

## Operational Gates

`tests/src/tests/imports/media-population-operational-gate.test.ts` preserves the full-size Phase 3 load measurement against the real workflow pool, Redis projection, sandbox processes, and database. It is discoverable but skipped by default because the successful measurement can consume up to its full 15-minute budget. Run it explicitly from this package with `RUN_OPERATIONAL_GATES=1 bun run test -- src/tests/imports/media-population-operational-gate.test.ts`; `true` is also accepted. Do not reduce its workload, timeout, assertions, or infrastructure path.

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

- Inner poll budgets (event waits in `fixtures/events.ts`, sandbox polls in `fixtures/sandbox.ts`) are sized generously and kept comfortably below the outer 180s per-test timeout (`testTimeout`/`hookTimeout` in `vitest.config.ts`), so a genuine hang still fails. Automation and sandbox results flow through the durable-queue pipeline, whose p99 latency spikes under full-suite load — that's what the headroom is for.
- Keep shared-harness `maxWorkers=3`, `SANDBOX_WORKER_CONCURRENCY=32`, and app/workflow pool maxima at 100 each. The cluster `SingleRunner` reserves one workflow connection, leaving 99; two `DurableQueue` workers consume up to two more, so workflow headroom for file-parallel durable work is `99 - 32 - 2 = 65` connections. The configured app and workflow maxima total 200 against the test Postgres `max_connections=400`, leaving capacity for server overhead. These are test-harness settings; production defaults remain 5 sandbox workers and 10 connections in each pool.
- Retain these values without fresh load evidence. A prior full-suite measurement peaked at 120 total database connections and 4 active connections after the pool increase; the separate successful full-size operational run recorded zero app-pool waits. This is historical evidence, not a fresh Task 12 measurement.
- Diagnose pressure from the combined signals: app-pool `waitingCount > 0`, random cross-suite 180s timeouts, active or total connections nearing a ceiling, advisory/lock waits, deadlock deltas, Redis projection errors or stalled high-water progress, and overlapping sandbox work. Pool starvation can surface as cross-cutting timeouts rather than an explicit exhaustion error. Keep the operational gate separate and opt-in for fresh load evidence.

## Isolation

Parallel test runs share one backend, so keep fixtures collision-free: use randomized external ids (e.g. the random TMDB id in `seedGlobalShowEpisodeTree`) and a unique schema slug per user when two users must exercise the same schema shape (in production each user has their own schema anyway).

## Media Monitoring

`tests/src/tests/media-monitoring/media-monitoring.test.ts` installs an offline details provider through the real plugin endpoint, then exercises status/enable/disable through `@ryot/plugin-media` operation recipes and the generic plugin invoke transport. Its cron case reinstalls updated plugin source and uses the admin targeted plugin-cron hook for `media/media-monitoring`, plus a local Apprise server so baseline silence, provider refresh, signal production, subscription audience resolution, and notification delivery are covered together. `fixtures/media-monitoring.ts` owns the single-item batch wrappers, the relationship-root query assertion, and `triggerCronAndWaitForEntity`, which passively registers interest before cron and waits for the refresh's `entity:updated` event. This helper is shared by every suite that forces a re-population through `enableMediaMonitoring` + the targeted cron, since `entityImport.import` is ensure-mode and no-ops on an already-populated entity.

Association detector suites live in `tests/src/tests/media-monitoring/association-detectors*.test.ts` and `media-entity-update-signals.test.ts`. Credit edges have two writers (a media-rooted additive incoming sync and a person/company-rooted authoritative outgoing sync); the shared cron-refresh mechanism above is how a test re-drives an already-populated root to exercise role updates, authoritative deletes, and re-creates from either direction.
