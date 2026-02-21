# Tests Guidelines

This package contains end-to-end and integration-style tests for Ryot.

## Conventions

- Keep end-to-end suites in `tests/src/<domain>/` folders that mirror backend modules; prefer descriptive filenames over `index.test.ts`.
- Prefer shared helpers in `tests/src/fixtures` for repeated auth setup, API setup, and test data builders.
- Favor fixture files with clear ownership (`auth`, `entity-import`, `entity-interest`, `entity-schemas`, `events`, `query-engine`, `saved-views`, `trackers`) over generic catch-all helpers.
- Keep `tests/src/test-support` for cross-cutting test infrastructure (assertions, backend/container provisioning), not domain fixtures.
- Do not refactor `tests/src/seed-script.ts` as part of test fixture cleanup unless explicitly requested.
- Document how a test pattern or fixture works in this file, and how the backend behaves in `apps/app-backend/AGENTS.md`, rather than in scattered code comments. Keep inline comments to hyper-local notes that decode a single assertion (expected order, arithmetic) or justify a lint suppression.

## Hermetic Provider Tests

Every provider-driven test except the live smoke suite runs offline against a fake provider, so search/import/populate/translate/trending flows stay deterministic and make no external calls.

- `seedBuiltinProviderScript` (`fixtures/sandbox-provider.ts`) inserts a builtin (global, `user_id` null) `sandbox_script` row directly via SQL, mirroring how the backend seeds real provider scripts at startup. Pair it with `cleanupBuiltinProviderScript` in `afterAll`/`afterEach`; that helper deletes the global entities the script produced, any relationship touching them, the schema link, then the script, and swallows all failures so cleanup never masks a test failure.
- Build driver code with `searchDriverCode` / `detailsDriverCode` / `translateDriverCode` (or an inline `driver("<kind>", …)` for trending, etc.). Each emits a `driver("<kind>", …)` registration returning fixed data with no network access; concatenate several with `join("\n")` to register multiple drivers in one script.
- Link a script to an entity schema (`linkToEntitySchemaId` → `entity_schema_sandbox_script`) only when a `details` result references a related entity by the provider's slug, so it resolves as that schema's provider. Plain search/import (by `scriptId`) and provenance-based population need no schema link — the entity's own `sandbox_script_id` provenance selects the driver.
- `translateDriverCode` always registers a `translate` driver — a fixed overlay for each named language and an empty object (an all-null negative-cache overlay) for any other. Register it even in "must not translate" cases: an erroneous premature translate then writes a detectable all-null overlay instead of erroring out.
- Provider metadata carries `providerInformation.canonicalLanguage`, which the backend read path uses to compute `translationStatus` (see app-backend `Entity Translation & Localization`).
- When one provider owns a relationship into another provider's entities, clean up sequentially, owner first (e.g. `entity-schemas-search-import` cleans the anime provider before the company provider it links to).

## Seeding Global Rows Directly

The contract API is scoped to a user's own trackers, so it cannot create the global (`user_id` null) rows providers own, nor reach global structural schemas. Seed and read those directly via SQL:

- `seedGlobalShowEpisodeTree` (`fixtures/media.ts`) inserts a global show → season → episode entity/relationship tree so import/webhook flows resolve an episode positionally with no external calls. The schemas and TMDB script still come from the API; only the global entity/relationship rows (which no API can create) are inserted directly.
- Structural sub-entity schemas (`show-season`, `show-episode`, `podcast-episode`) are global and linked to no user tracker, so the tracker-scoped entity-schema list API cannot see them; `getBuiltinEntitySchemaId` (`fixtures/entity-schemas.ts`) looks them up by slug directly.
- `seedEntityTranslation` (`fixtures/translations.ts`) inserts an `entity_translation` row directly, modeling a completed provider fill for one `(entity, language)` pair; a null `name`/`properties` models a negative-cache (canonical-fallback) row.
- `auth-god-mode-recovery` inserts an `account` row directly because linking a second (OIDC) account to an existing credential user has no API.

## SSE Interest Streams

- `openInterestStream` (`fixtures/interest-sse.ts`) opens an authenticated SSE interest stream (auth via the `Cookie` header), collects `entity:updated` frames, and exposes `declareInterest`, `waitForEntityUpdated`, and `expectNoEntityUpdated`. `declareInterest` POSTs the interest set for the stream and returns any immediate terminal catch-up frames from the response body. The SSE parser ignores comment lines such as the `: ping` heartbeat.
- Reads never trigger fills; declaring interest does — see app-backend `Interest & Population Dispatch`.

## OIDC Sign-In Flow

`oidcSignIn` (`fixtures/auth-oidc.ts`) drives the full Better Auth OIDC handshake in three steps: (1) POST `/auth/sign-in/oauth2` returns `{ url }` and sets a state cookie; (2) POST that authorize URL to the mock OIDC server with a username (`mock-oauth2-server` auto-approves any posted username) and read the callback URL from the `location` header; (3) GET the backend callback with the state cookie, at which point Better Auth exchanges the code, creates/looks up the user, and sets the session cookie.

## Live Provider Smoke Tests

`tests/providers-live-smoke.test.ts` is the only suite that makes real external HTTP calls; it is gated behind `RUN_LIVE_PROVIDER_TESTS` (`=1`/`true`) so PR CI stays fast and deterministic. Run it in a nightly/pre-release job as an early-warning signal for upstream drift — provider schema changes, endpoint moves, and auth/credential failures a fully-mocked test can never surface. Coverage is intentionally minimal (a drift signal, not exhaustive): OpenLibrary book search → import (keyless) and TMDB movie translate-on-interest (requires `providers.tmdbAccessToken`, else the translate never completes and the test times out). It imports the first real search result by its own `externalId` (never a hardcoded provider id format) and asserts the localized overlay differs from the canonical name and is non-empty rather than an exact string, since upstream copy can drift.

## Query-Engine Parity

`query-engine-sql-pushdown.test.ts` asserts that aggregates/time-series over a filtered source, relationship-root filtering, and correlated exists/aggregate return the same results whether they run pushed down in SQL or app-side.

## Timeouts & Pool Sizing

- Inner poll budgets (event waits in `fixtures/events.ts`, sandbox polls in `fixtures/sandbox.ts`) are sized generously and kept comfortably below the outer 180s per-test timeout (`package.json`), so a genuine hang still fails. Trigger and sandbox results flow through the durable-queue pipeline, whose p99 latency spikes under full-suite load — that's what the headroom is for.
- `DATABASE_WORKFLOW_POOL_MAX` (`test-support/provisioning.ts`) must exceed `SANDBOX_WORKER_CONCURRENCY` plus headroom: the cluster `SingleRunner` permanently holds one connection for its shard advisory lock, so usable connections = max − 1. Starving this pool manifests as random cross-cutting timeouts, not an obvious pool-exhaustion error. The Postgres container's `max_connections` must in turn cover the app pool, the workflow pool, and the harness pool combined.

## Isolation

Parallel test runs share one backend, so keep fixtures collision-free: use randomized external ids (e.g. the random TMDB id in `seedGlobalShowEpisodeTree`) and a unique schema slug per user when two users must exercise the same schema shape (in production each user has their own schema anyway).

## Media Monitoring

`tests/src/media-monitoring/media-monitoring.test.ts` seeds an offline details provider, then exercises status/enable/disable through the typed contract client. Its cron case uses the real admin infrequent-cron trigger and a local Apprise server, so baseline, provider refresh, subscriber fan-out, and notification delivery are covered together. `fixtures/media-monitoring.ts` owns the endpoint wrappers and media-monitoring relationship SQL assertion.
