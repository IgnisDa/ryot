# E2E

API and browser integration tests run with Bun's native test runner and file isolation.

## Commands

Do not run the entire e2e suite together. For final acceptance, run files separately so failures remain isolated:

```bash
bun turbo --filter=@ryot-app/e2e test --only -- '<file1>' '<file2>'
```

The large media gates and live-provider smoke are discovered but opt-in. Never combine them with
standard files. Turbo does not pass their opt-in variables to tasks, so run them through the package
script:

```bash
RUN_OPERATIONAL_GATES=1 bun --cwd e2e run test 'src/api/plugins/media/imports/media-population-operational-gate.test.ts'
RUN_OPERATIONAL_GATES=1 bun --cwd e2e run test 'src/api/plugins/media/imports/media-population-overlap-gate.test.ts'
RUN_OPERATIONAL_GATES=1 bun --cwd e2e run test 'src/api/plugins/fitness/imports/checkpoint-recovery.test.ts'
RUN_OPERATIONAL_GATES=1 bun --cwd e2e run test 'src/api/plugins/media/integrations/checkpoint-scale.test.ts'
RUN_LIVE_PROVIDER_TESTS=1 bun --cwd e2e run test 'src/api/plugins/media/smoke/providers-live-smoke.test.ts'
```

The capacity gate exercises production-size durable execution with a 15-minute budget. The overlap
gate submits overlapping 5/20-import waves and requires completion without PostgreSQL deadlocks.
The checkpoint recovery gate imports 3,201 measurements and kills the API after a saved application
checkpoint. It verifies unique records after restart and records checkpoint and journal sizes.
The sync gate collects 101 provider windows twice and verifies that unchanged progress retains its
event identities. Run these gates separately to keep their timing and memory samples interpretable.
Live smoke may require credentials and tests stable provider properties, not exact upstream copy.

## Harness

`global-setup.ts` builds required artifacts, provisions PostgreSQL and object storage, then starts one shared backend serving the SPA and `/api` from one origin. It publishes that backend through `E2E_API_URL`, `E2E_FRONTEND_URL`, and `E2E_ADMIN_ACCESS_TOKEN`, which worker processes inherit. The shared server uses an isolated log directory; `E2E_SERVER_LOG_FILE` lets scoped fixtures add retained log files without changing the active log.
Each isolated test file decodes this configuration into a shared target. Isolated servers return their own target and never change the worker environment. Pass that target to session constructors and target-only setup helpers. Sessions bind their HTTP calls, companion upload/download/WebSocket URLs, and `adminCall` authority to the same target; installed plugin fixtures retain it for updates and strict cleanup. API and frontend URLs remain separate for OAuth and replica cases. Cross-server backups explicitly download through the source session and upload through the destination session.
Each acquired container, storage client, and API process registers a Scope finalizer before later setup runs. Startup failure or interruption closes acquired resources; normal teardown stops API processes before their infrastructure. Testcontainers' Ryuk reaper removes containers if the test process exits unexpectedly. Server and PostgreSQL logs are retained after teardown.
On macOS, setup holds a `caffeinate` idle-sleep assertion until teardown or runner exit so wall-clock deadlines and OAuth tokens remain valid during the run.

The PostgreSQL container enables lock-wait and failed-statement logging with PID and transaction ID
prefixes. Setup prints the retained log path. A deadlock entry contains PostgreSQL's process graph and
the conflicting statements; inspect that file before the test teardown process exits.

Up to six files, and no more than the machine's available parallelism, share the backend concurrently. Servers a file starts with `startApiProcess` are marked as the first out-of-memory victims on Linux, so memory pressure costs that file instead of the shared backend. Tests and hooks time out after 180 seconds. Tests that write 101-set workouts raise their own timeout with `LARGE_WORKOUT_BUDGET` from the Fitness fixtures, which also bounds their event-write waits for sequential production policy workflows and record processing. The opt-in media gates raise their own timeout to their gate budget plus 30 seconds. `startIsolatedApiServer` and `startIsolatedHarness` start an API with its own infrastructure and optional `extraEnv` for suites that need different server configuration; `startApiProcess` owns spawning and the health wait for suites that share infrastructure across processes. Each spawned API writes a unique `SERVER_LOG_FILE` under the OS temp directory, captures its console output beside it as `.stdout` and `.stderr`, and prints those paths. Health checks fail as soon as the API process exits.

System plugins are instance-wide, so installing, updating, or removing one on the shared backend marks every open page stale and covers it with the update prompt. The test launcher runs browser files and `src/api/kernel/pages` before other API files. API files may change system plugins on the shared backend. A file that changes system plugins while pages in other files may be open, or whose own pages must survive such changes, calls `runFileOnIsolatedServer` at module level; the helper points the file's fixture defaults at its own server.

Fixtures mirror ownership: generic platform fixtures live under `src/fixtures/kernel`, plugin-owned domain fixtures under `src/fixtures/plugins/<plugin>`, and cross-cutting harness code under `src/support`. There is no aggregate fixture barrel. Kernel suites that need plugin-owned schemas import that plugin fixture explicitly.

Effect-native fixtures return effects. `it.live` supplies per-test `Scope` and the shared E2E services (HTTP client, Playwright spawner, plugin compilers) without `TestClock`; do not use `it.effect` for real-time waits. Scoped network resources use `Effect.acquireRelease`; `startFakeHttpServerScoped` and `startFakeAppriseServerScoped` close their servers with the test Scope. Bun hooks run Effect setup with the harness `runPromise`, which provides the same services, and await `stop()` cleanup. Wrap unavoidable third-party Promise APIs at fixture boundaries with typed `Effect.tryPromise` errors.

E2E enforces the normal Effect async, HTTP, JSON, and platform rules. Keep local inline suppressions only where Playwright evaluates an async callback in the browser or an external API requires a Promise callback; state the boundary in the comment. The two seed scripts have explicit file-scoped lint exemptions.

Provider fixtures install offline scripts through the real admin plugin endpoint. Best-effort teardown stops on persistent references; tests that assert removal must delete references and use strict uninstall. Admin setup uses typed `testSupport` operations. Resolve plugin-owned definitions by plugin plus local slug because local slugs are not globally unique.

The SSE catalog and live-updates fixtures validate transport headers/frames and support OAuth or API keys. The live-updates fixture asks for population through the populate endpoint, buffers `entity-updated` frames for later waits, and closes its stream with the test scope; the protocol is described in [`kernel/client/src/modules/entity-watches/README.md`](../kernel/client/src/modules/entity-watches/README.md).

## Assertions

`pluginNamespacePackages` creates independent Whiskey packages A/B with identical metadata and
local declarations. A2 preserves A's package identity and adds an optional field; Claim deliberately
uses A's identity with different executable content. Each case gets fresh package identities and
external IDs. Select installations, definitions, operations and routes by exact owner, never by
the shared `whiskey` slug. Provider graphs use offline compiled scripts; suspended-writer cases
use a scoped fake upstream. The fixture is available through `~/fixtures/kernel`.

Assert the transport tag or category, module-owned kebab-case reason code, and structured parameters. Never assert server English, localized copy, or diagnostic prose. Raw compiler/runtime diagnostics may be asserted only on plugin-author, admin, or test surfaces that explicitly expose them.

## Capacity

The shared harness uses at most six workers (no more than the available parallelism), sandbox worker concurrency 5 with a 2,304 MiB sandbox memory budget (memory admission reserves each run's worst case, and the derived default admits about two runs), an API database pool of 100, and PostgreSQL `max_connections=400`. Keep production Effect Cluster expiry behavior so recovery regressions remain visible. Do not raise worker, sandbox, or pool settings without fresh load evidence.

Watch app-pool waits, cross-suite timeouts, connection ceilings, lock waits,
stalled progress, and overlapping sandbox work.
