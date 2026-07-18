# E2E

This package contains API end-to-end and integration tests running on Vitest over Bun.

## Running Tests

Run discovered suite:

```bash
bun turbo --filter=@ryot-app/e2e test
```

For final acceptance, run each standard file separately so failures retain file-level isolation:

```bash
bun turbo --filter=@ryot-app/e2e test --only -- '<file>'
```

Two standalone media suites are discovered but skipped without explicit gates. Do not combine either with standard files.

Full-size operational gate:

```bash
RUN_OPERATIONAL_GATES=1 bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/plugins/media/imports/media-population-operational-gate.test.ts'
```

Live provider drift smoke:

```bash
RUN_LIVE_PROVIDER_TESTS=1 bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/plugins/media/smoke/providers-live-smoke.test.ts'
```

Operational gate exercises production-size workflow, Redis, sandbox, and database path with a 15-minute budget. Live smoke covers OpenLibrary import and TMDB translation and may require provider credentials.

Sandbox runtime benchmark:

```bash
RUN_SANDBOX_BENCHMARKS=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot-app/e2e test --only -- 'src/api/kernel/sandbox/sandbox-runtime-benchmark.test.ts'
```

`SANDBOX_PROCESS_MODE` defaults to `on-demand`; set it to `warm` to benchmark the warm pool.

## Harness

`global-setup.ts` builds the kernel client and test plugin archive, provisions containers, and starts one shared backend process. The backend serves the built SPA and `/api` from the same origin, matching the production topology. The origin and API URL are provided through Vitest `inject`; worker modules cannot import global setup state directly.

Up to two files share the API process concurrently. Tests and hooks have 180-second limits, and the hanging-process reporter identifies leaked handles.

## Fixtures

`src/fixtures/` mirrors the ownership split of `src/api/`: `kernel/` holds fixtures for generic platform concepts, and `plugins/<plugin>/` holds fixtures that seed or assert domain data owned by that plugin's manifest (its entity/event/relationship schemas, saved views, providers, or import sources). Each side has its own barrel (`~/fixtures/kernel`, `~/fixtures/plugins/<plugin>`) and there is no combined barrel, so a `src/api/kernel/**` suite cannot reach a plugin fixture through an implicit re-export — a suite that legitimately needs plugin-seeded data (for example, to exercise a generic capability against the only builtin schemas the e2e environment has) says so with an explicit `~/fixtures/plugins/<plugin>` import.

Effect-native fixtures return effects rather than promises. Scoped network fixtures use `Effect.acquireRelease`, and `it.live` supplies per-test Scope without TestClock so resources close automatically. Wrap raw promise boundaries with `Effect.promise` inside Effect test bodies.

`pollUntil` retries an Effect check until it returns non-null. Every spawned API process writes to a unique `SERVER_LOG_FILE` under the OS temp directory; startup output prints the path for diagnosis.

## Failure Assertions

Assert typed failure structure: the transport tag or category, the module-owned kebab-case code,
and its structured parameters. Do not assert server English, localized copy, or diagnostic prose.
Raw compiler/runtime diagnostics may be asserted only by tests for the explicit plugin-author,
admin, or test surfaces that are allowed to expose them.

## Provider Fixtures

Provider-driven tests install complete offline scripts through real admin plugin endpoint with `installTestProvider`. Pair with best-effort uninstall when production references may correctly block removal.

- Build fixed operations with `fakeProviderSearchResult`, `fakeProviderDetailsResult`, and `fakeProviderTranslations`.
- Add schema-provider link only when provider details reference related entities owned by another provider.
- Non-empty translation fixture defines translate operation and returns all-null overlay for unnamed languages, making premature translation observable as negative cache.
- Clean linked providers sequentially, relationship owner first.

Live smoke is drift detection, not exhaustive correctness. It uses real result IDs and asserts stable properties rather than exact upstream text.

## Admin Fixtures

Admin-only setup uses typed `testSupport` contract with `adminHeaders`.

Sandbox coverage installs source through `installTestPlugin` or `installTestPluginBundle`, resolves persisted content-addressed IDs, and invokes admin enqueue/result hooks. Reinstall changed source to obtain new ID. Use strict uninstall only when successful removal is assertion.

Entity, event, and relationship definitions install as scriptless plugins through real plugin endpoint. Global seeding uses test-support entity and relationship operations; user-scoped entities use authenticated API.
Resolve plugin-owned definition fixtures by plugin slug and definition slug; definition slugs are not globally unique.

## Plugin Catalog Event Stream Fixture

`src/fixtures/kernel/plugin-catalog-events.ts` validates the HTTP status and SSE headers, parses catalog events, and supports OAuth or API-key-authenticated clients. `src/api/kernel/plugins/catalog-events.test.ts` covers an API key receiving a valid `/api/plugins/events` stream.

## Entity Interest WebSocket Fixture

`src/fixtures/kernel/interest-websocket.ts` requests a short-lived ticket through the supplied OAuth or API-key client, opens a real ticket-authenticated WebSocket, sends the ticket as its first frame, and exposes the `ready.sessionId` for admin test support. Invalid tickets receive the generic authentication close; ticket-store failures receive an internal close. Established sockets have a fixed 15-minute lease and close with application code `4001` (`Session expired`), after which clients obtain a new ticket and reconnect. The fixture sends revisioned `replace` and `update` commands, waits for matching `applied` acknowledgements, buffers validated `entity-updated` messages, responds to application heartbeats, and exposes scoped close and completion-wait helpers. It fails tests on malformed server messages, unexpected close, rejected commands, or acknowledgement timeout. Protocol is documented in `kernel/backend/src/modules/entity-interest/README.md`.

## OIDC

`oidcSignIn` starts a first-party PKCE authorization, drives Better Auth OIDC through the mock server while preserving its state cookie, continues the signed Ryot authorization, and exchanges the resulting code for an OAuth access token. The fixture threads that token as `Authorization: Bearer`. The state cookie is Better Auth's browser-session and CSRF handshake, not an application API credential.

## Capacity

Shared harness keeps `maxWorkers=2`, fixed sandbox limits, and app/workflow pool maxima at 100. Test PostgreSQL allows 400 connections. Sandbox worker concurrency is fixed at five and production uses ten connections per pool.

Keep production Effect Cluster expiry settings in harness so recovery regressions remain visible. Last full-suite evidence peaked at 120 total database connections; full-size operational gate recorded no app-pool waits.

Investigate pool pressure through app waiting count, random cross-suite timeouts, connection ceilings, lock waits, Redis projection errors, stalled progress, and overlapping sandbox work.
