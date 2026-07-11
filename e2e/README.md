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

The large media gate and live-provider smoke are discovered but opt-in. Never combine either with standard files.

```bash
RUN_OPERATIONAL_GATES=1 bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/plugins/media/imports/media-population-operational-gate.test.ts'
RUN_LIVE_PROVIDER_TESTS=1 bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/plugins/media/smoke/providers-live-smoke.test.ts'
```

Run the StyleX tracer browser composition separately. This builds its dedicated archive, enables
the backend tracer graph, and verifies Chromium and Playwright WebKit without changing ordinary
E2E or shipped-plugin registration.

```bash
RUN_STYLEX_TRACER_E2E=1 bun turbo --env-mode=loose --filter=@ryot-app/e2e test --only -- 'src/browser/stylex-tracer.test.ts'
```

The tracer setup hashes `kernel/client/dist/index.html` and requires the backend response to have the
same bytes before the browser assertions run. This distinguishes production output from Vite.

The source-edit cycle is a separate disposable-root check. It requires free ports 3000 and 3005 and
must not target a developer's active worktree:

```bash
RUN_STYLEX_TRACER_E2E=1 RUN_STYLEX_TRACER_HMR_E2E=1 \
STYLEX_TRACER_HMR_ROOT=/absolute/disposable-root \
STYLEX_TRACER_HMR_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/hmr-evidence.json" \
bun --bun run --cwd e2e vitest run 'src/browser/stylex-tracer-hmr.test.ts'
```

The safe-area browser check injects nonzero values at the shell's hidden platform detector because
desktop Playwright browsers cannot expose native safe-area environment values. It verifies the
production detector-to-shell-to-plugin bridge, not a native device. The shared routing wrapper also
retains its inline `var(--bg)` and computes transparent in the Tailwind-free tracer document; the
tracer document's own full-size StyleX background is the explicit paint and known experiment limit.

The operational gate exercises production-size workflow, Redis, sandbox, and database paths with a 15-minute budget. Live smoke detects provider drift, may require credentials, and asserts stable properties rather than exact upstream text.

Run sandbox benchmarks separately. `SANDBOX_PROCESS_MODE` defaults to `on-demand`; use `warm` to measure the warm pool.

```bash
RUN_SANDBOX_BENCHMARKS=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot-app/e2e test --only -- 'src/api/kernel/sandbox/sandbox-runtime-benchmark.test.ts'
```

## Harness

`global-setup.ts` builds required artifacts, provisions PostgreSQL, Redis, and object storage, then starts one shared backend serving the SPA and `/api` from one origin. It publishes that backend through `E2E_API_URL`, `E2E_FRONTEND_URL`, and `E2E_ADMIN_ACCESS_TOKEN`, which worker processes inherit.

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
