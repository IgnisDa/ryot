# Testing Infrastructure

`@ryot-app/testing/postgres-container` owns the shared PostgreSQL test container. Its
`startPostgresContainerEffect` and `stopPostgresContainerEffect` operations wrap Testcontainers
and Node log-stream completion once, with typed `PostgresContainerError` failures. The existing
Promise-returning `startPostgresContainer` and `stopPostgresContainer` exports serve the E2E
fixture; `postgresTestSetup` provisions scoped infrastructure for the native Bun runner. An explicit
`TEST_DATABASE_URL` uses the supplied database without starting a container.

`@ryot-app/testing/redis-container` owns the shared Redis test container: `redisTestSetup` starts
one scoped Testcontainers Redis for a suite. An
explicit `TEST_REDIS_URL` uses the supplied instance without starting a container; tests namespace
their keys, so a shared instance needs no flush.

## Test Runner

`bun run test` runs workspace tests without e2e. Use filtered root-level Turbo runs for affected
packages and select explicit e2e files through the e2e package script. Do not invoke `bun test` at
the repository root: client packages need the shared environment dispatcher and integration suites
need parent-owned setup.

Package scripts launch `bun test --isolate`. Effect tests import `it` and `layer` from
`@voila.dev/effect-bun-test`; native assertions, suites, and hooks come from `bun:test`.
Callable narrowing assertions use `@ryot-app/testing/assert`. Plain tuple-based parameterized tests use native
`test.each`, while Effect parameterized tests use `it.effect.each`.

`runTests` owns the child runner in an Effect Scope. Backend, sandbox, and e2e setup runs in the
parent process so isolated test files cannot stop shared infrastructure. Test failures propagate
after scoped teardown. Worker processes inherit provisioned database and Redis URLs. `testWorkers`
resolves the worker count the same way Bun does (the last `--parallel`, else the caller's default)
so setup can size shared infrastructure before the runner starts.

The runner publishes the native timeout as `RYOT_TEST_TIMEOUT`. Effect tests pass `testTimeout`
from `@ryot-app/testing/test-timeout` as their explicit registration budget. The community runner
then interrupts their fibers and runs finalizers before Bun's backstop expires. Per-test budgets
take precedence; zero disables the suite timeout.

Client packages use `src/run-client-tests.ts`, which runs `.test.ts` files without browser globals
and `.test.tsx` files with the shared jsdom preload. Each file gets a fresh global and React cleanup.
DOM events come from that window, including their subclasses. Fetch, Request, Blob, MessagePort,
and global cancellation remain Bun-native. DOM listeners use their owning window's AbortController;
host I/O uses the global controller. Signals must not cross these API realms.
File filters and native Bun test flags can be passed through the package test script.
