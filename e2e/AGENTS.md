# E2E Tests

- Import test APIs from `~/support/effect-test` and use `it.live`, not `it.effect`: real I/O must not run under TestClock. Hooks use its `runPromise`; scripts and global setup use `~/support/e2e-runtime`.
- Keep platform suites and fixtures under their kernel trees and domain suites and fixtures under their plugin trees. Use `src/support` for cross-cutting harness code, not an aggregate fixture barrel.
- Derive HTTP fixture types from `@ryot-app/contract/client`, not handwritten mirrors.
- Keep providers hermetic except `providers-live-smoke.test.ts`. Seed through typed `testSupport` operations and production services, never raw row writes or public script-execution fixtures.
- Give shared-server cases collision-free external IDs and fresh package identities. Resolve declarations by exact owner and local slug, never display names.
- Use `assertCompleted` and `requireCompletedSandboxValue` for asynchronous job results.
- Read `README.md` before changing the harness or capacity. Pool and worker changes require fresh load evidence. Do not refactor `src/scripts/seed.ts` without an explicit request.
