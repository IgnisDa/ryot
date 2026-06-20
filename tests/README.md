# Tests

This package contains end-to-end and integration tests running on Vitest over Bun.

## Running Tests

Run discovered suite:

```bash
bun turbo --filter=@ryot/tests test
```

For final acceptance, run each standard file separately so failures retain file-level isolation:

```bash
bun turbo --filter=@ryot/tests test --only -- '<file>'
```

Two standalone media suites are discovered but skipped without explicit gates. Do not combine either with standard files.

Full-size operational gate:

```bash
RUN_OPERATIONAL_GATES=1 bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/imports/media-population-operational-gate.test.ts'
```

Live provider drift smoke:

```bash
RUN_LIVE_PROVIDER_TESTS=1 bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/smoke/providers-live-smoke.test.ts'
```

Operational gate exercises production-size workflow, Redis, sandbox, and database path with a 15-minute budget. Live smoke covers OpenLibrary import and TMDB translation and may require provider credentials.

Sandbox runtime benchmark:

```bash
RUN_SANDBOX_BENCHMARKS=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/sandbox-runtime-benchmark.test.ts'
```

`SANDBOX_PROCESS_MODE` defaults to `on-demand`; set it to `warm` to benchmark the warm pool.

## Harness

`global-setup.ts` provisions containers and one shared backend, then provides `backendUrl` to workers. `src/support/backend.ts` reads it through Vitest `inject`; worker modules cannot import global setup state directly.

Up to two files share the backend concurrently. Tests and hooks have 180-second limits, and the hanging-process reporter identifies leaked handles.

Effect-native fixtures return effects rather than promises. Scoped network fixtures use `Effect.acquireRelease`, and `it.live` supplies per-test Scope without TestClock so resources close automatically. Wrap raw promise boundaries with `Effect.promise` inside Effect test bodies.

`pollUntil` retries an Effect check until it returns non-null. Every spawned backend writes to unique `SERVER_LOG_FILE` under OS temp directory; startup output prints path for diagnosis.

## Failure Assertions

Assert typed failure structure: the transport tag or category, the module-owned kebab-case code,
and its structured parameters. Do not assert backend English, localized copy, or diagnostic prose.
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

## Entity Interest WebSocket Fixture

`src/fixtures/interest-websocket.ts` requests a short-lived ticket, opens a real authenticated WebSocket, sends the ticket as its first frame, and exposes the `ready.sessionId` for admin test support. It sends revisioned `replace` and `update` commands, waits for matching `applied` acknowledgements, buffers validated `entity-updated` messages, responds to application heartbeats, and exposes scoped close and completion-wait helpers. It fails tests on malformed server messages, unexpected close, rejected commands, or acknowledgement timeout. Protocol is documented in `kernel/backend/src/modules/entity-interest/README.md`.

## OIDC

`oidcSignIn` drives Better Auth OIDC flow through mock server: start sign-in and retain state cookie, submit username to authorize endpoint, then request backend callback with same cookie to establish session.

## Capacity

Shared harness keeps `maxWorkers=2`, fixed sandbox limits, and app/workflow pool maxima at 100. Test PostgreSQL allows 400 connections. Sandbox worker concurrency is fixed at five and production uses ten connections per pool.

Keep production Effect Cluster expiry settings in harness so recovery regressions remain visible. Last full-suite evidence peaked at 120 total database connections; full-size operational gate recorded no app-pool waits.

Investigate pool pressure through app waiting count, random cross-suite timeouts, connection ceilings, lock waits, Redis projection errors, stalled progress, and overlapping sandbox work.
