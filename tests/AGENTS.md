# Tests

- Read `README.md` before changing runner, shared harness, pool sizing, or opt-in gates.
- Place generic platform suites under `src/tests/kernel/` and plugin behavior under its `src/tests/plugins/<plugin>/` tree. Split mixed ownership and use descriptive filenames.
- Keep domain fixtures in `src/fixtures` and cross-cutting harness code in `src/support`; avoid generic catch-all helpers.
- Import test APIs only from `~/support/effect-test`. Test bodies use `Effect.gen` under `it.live` or `it.scopedLive`; never use `it.effect`, whose test clock deadlocks real-time waits. Keep Vitest hooks plain async with `Effect.runPromise`.
- Keep provider tests hermetic except `providers-live-smoke.test.ts`.
- Seed through typed `testSupport` operations and production service paths; do not mutate stored rows or add public script-execution fixtures.
- Shared-backend fixtures need collision-free external IDs, plugin slugs, and schema slugs.
- Use `assertCompleted` and `requireCompletedSandboxValue` for async job results.
- Do not refactor `src/seed-script.ts` unless explicitly requested.
- Change worker, sandbox, or database pool settings only with fresh load evidence.
