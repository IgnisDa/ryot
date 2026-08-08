# Tests

- Read `README.md` before changing runner, shared harness, pool sizing, or opt-in gates.
- Place generic platform suites under `src/api/kernel/` and plugin behavior under its `src/api/plugins/<plugin>/` tree. Split mixed ownership and use descriptive filenames.
- Fixtures live under `src/fixtures/kernel` (generic platform fixtures) and `src/fixtures/plugins/<plugin>` (fixtures owned by that plugin), each with its own barrel (`~/fixtures/kernel`, `~/fixtures/plugins/<plugin>`); do not add an aggregate barrel spanning both. Keep cross-cutting harness code in `src/support`; avoid generic catch-all helpers.
- Derive HTTP payload, query, path, success, and nested plugin manifest types from `@ryot/contract/client`; compose deliberate fixture transformations with indexed access, `Pick`, `Omit`, `Partial`, or mapped types instead of writing structural mirrors.
- Import test APIs only from `~/support/effect-test`. Test bodies use `Effect.gen` under `it.live`; `it.live` supplies per-test Scope without TestClock; never use `it.effect` because test clock deadlocks real-time waits. Keep Vitest hooks plain async with `Effect.runPromise`.
- Keep provider tests hermetic except `providers-live-smoke.test.ts`.
- Seed through typed `testSupport` operations and production service paths; do not mutate stored rows or add public script-execution fixtures.
- Shared-API fixtures need collision-free external IDs, plugin slugs, and schema slugs.
- Use `assertCompleted` and `requireCompletedSandboxValue` for async job results.
- Do not refactor `src/scripts/seed.ts` unless explicitly requested.
- Change worker, sandbox, or database pool settings only with fresh load evidence.
