# E2E

API and browser integration tests run with Vitest over Bun.

## Commands

Run the discovered suite:

```bash
bun turbo --filter=@ryot-app/e2e test
```

For final acceptance, run each standard file separately so failures remain isolated:

```bash
bun turbo --filter=@ryot-app/e2e test --only -- '<file>'
```

The large media gates and live-provider smoke are discovered but opt-in. Never combine them with
standard files.

```bash
RUN_OPERATIONAL_GATES=1 bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/plugins/media/imports/media-population-operational-gate.test.ts'
RUN_OPERATIONAL_GATES=1 bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/plugins/media/imports/media-population-overlap-gate.test.ts'
RUN_LIVE_PROVIDER_TESTS=1 bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/plugins/media/smoke/providers-live-smoke.test.ts'
```

The capacity gate exercises production-size workflow, Redis, sandbox, and database paths with a
15-minute budget. The overlap gate repeatedly submits 5 and 20 imports whose tracks share artists
and an album; it requires every import to complete and the PostgreSQL deadlock counter to remain
unchanged. Live smoke detects provider drift, may require credentials, and asserts stable properties
rather than exact upstream text.

## Harness

`global-setup.ts` builds required artifacts, provisions PostgreSQL, Redis, and object storage, then starts one shared backend serving the SPA and `/api` from one origin. It publishes that backend through `E2E_API_URL`, `E2E_FRONTEND_URL`, and `E2E_ADMIN_ACCESS_TOKEN`, which worker processes inherit.

The PostgreSQL container enables lock-wait and failed-statement logging with PID and transaction ID
prefixes. Setup prints the retained log path. A deadlock entry contains PostgreSQL's process graph and
the conflicting statements; inspect that file before the test teardown process exits.

Up to four files share the backend concurrently. Tests and hooks time out after 180 seconds. The hanging-process reporter identifies leaked handles. Each spawned API writes a unique `SERVER_LOG_FILE` under the OS temp directory and prints its path.

Fixtures mirror ownership: generic platform fixtures live under `src/fixtures/kernel`, plugin-owned domain fixtures under `src/fixtures/plugins/<plugin>`, and cross-cutting harness code under `src/support`. There is no aggregate fixture barrel. Kernel suites that need plugin-owned schemas import that plugin fixture explicitly.

Effect-native fixtures return effects. `it.live` supplies per-test `Scope` without `TestClock`; do not use `it.effect` for real-time waits. Scoped network resources use `Effect.acquireRelease`. Wrap unavoidable promise APIs at fixture boundaries with typed `Effect.tryPromise` errors.

Provider fixtures install offline scripts through the real admin plugin endpoint. Best-effort teardown stops on persistent references; tests that assert removal must delete references and use strict uninstall. Admin setup uses typed `testSupport` operations. Resolve plugin-owned definitions by plugin plus local slug because local slugs are not globally unique.

The SSE catalog and entity-interest WebSocket fixtures validate transport headers/frames and support OAuth or API keys. The WebSocket fixture owns ticket authentication, revision acknowledgements, heartbeat replies, completion buffering, and scoped close; protocol details belong in [`kernel/backend/src/modules/entity-interest/README.md`](../kernel/backend/src/modules/entity-interest/README.md).

## Assertions

Assert the transport tag or category, module-owned kebab-case reason code, and structured parameters. Never assert server English, localized copy, or diagnostic prose. Raw compiler/runtime diagnostics may be asserted only on plugin-author, admin, or test surfaces that explicitly expose them.

## Capacity

The shared harness uses `maxWorkers=4`, sandbox worker concurrency 5, an API database pool of 100, and PostgreSQL `max_connections=400`. Keep production Effect Cluster expiry behavior so recovery regressions remain visible. Do not raise worker, sandbox, or pool settings without fresh load evidence.

Watch app-pool waits, random cross-suite timeouts, connection ceilings, lock waits, Redis projection errors, stalled progress, and overlapping sandbox work. Previous full-suite evidence peaked at 120 database connections; the full-size operational gate recorded no app-pool waits.
