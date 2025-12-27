# Complete Sandbox Cutover

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Complete the integrated cutover after Tasks 01 through 16. Verify that every former JavaScript source has an authoritative TypeScript or generated compiled replacement, remove all remaining fragment loaders and compatibility scaffolding, update owned documentation, and run the complete SDK, backend, and end-to-end verification surface described by the Current-State Replacement, Built-In Compilation, End-to-End Test Package Migration, Testing Decisions, and Further Notes sections.

This slice must not perform another provider redesign. Its purpose is to close gaps between completed family migrations, ensure the generated registry contains all 52 providers and five triggers exactly once, ensure the Deno runner and three former helper fragments are represented correctly, and prove no runtime or test path can execute raw TypeScript or legacy JavaScript fragments. The intentionally gated live provider smoke suite may remain gated, but it must compile against the new contracts and its documented invocation must remain valid.

## Acceptance criteria

- [x] All 61 former JavaScript sandbox sources have authoritative TypeScript-authored or generated compiled replacements as defined by the parent PRD
- [x] The generated registry contains 52 providers and five triggers exactly once with validated manifests
- [x] The Deno runner is TypeScript-authored, Deno-checked, compiled ahead of execution, and loaded with the approved runtime import map
- [x] The three former helper fragments are ordinary TypeScript modules with no top-level fragment returns or string injection
- [x] No sandbox runtime path uses dynamic function construction, raw TypeScript execution, legacy driver registration, direct npm specifiers, or unversioned package cache entries
- [x] Obsolete raw-text declarations, Vitest loaders, import rewriters, helper injectors, JavaScript lint overrides, and unused vendoring code are removed
- [x] Backend and test documentation describes SDK modules, compilation, persistence, capabilities, limits, ESM execution, E2E promotion, and structured errors accurately
- [x] The end-to-end package contains no legacy `driver(...)` source generation and no uncompiled executable SQL fixture
- [x] Built-in source and generated output freshness is enforced by check, test, build, and development workflows
- [x] Every built-in compiles and loads in Deno under production permissions and limits
- [x] SDK package check and tests pass
- [x] Backend package check and tests pass
- [x] End-to-end package check and full hermetic suite pass
- [x] Repository-wide Turbo check and build pass (all packages except the pre-existing, unrelated `@ryot/graphql` failure — see notes)
- [x] The live smoke suite remains gated, type-checks, and documents any dependency/API adaptation made during migration
- [x] No compatibility behavior outside the parent PRD's beta policy remains

## User stories addressed

- User story 1
- User story 23
- User story 32
- User story 33
- User story 35
- User story 36
- User story 41
- User story 42
- User story 43
- User story 44
- User story 45

## Completion notes

### Deno runner cutover

- The runner is now TypeScript-authored: `runner-source.sandbox.ts` + `runner-utilities.sandbox.ts` (replacing the former `.sandbox.js` fragments), Deno-checked via `sandbox:check-runner` (`deno check` with a dedicated `sandbox-runtime/deno.json`), and compiled ahead of execution by `sandbox:compile` (Bun bundle → ignored `runner.generated.ts`). `runtime.ts` loads that single generated module; there is no more raw-text import.
- The runner sources are excluded from the backend `tsc` and `oxlint` (they use Deno globals) and covered instead by `deno check`. Decision to use `deno check` over an `@types/deno`/tsc-shim was made deliberately for long-term health: Deno is already a hard runtime dependency here, and checking against the real runtime's own types avoids the drift/false-confidence of a community or hand-maintained shim on the most security-sensitive file in the sandbox.

### Legacy removal

- Removed the entire format-0 path: `legacy-module.ts` (`compileLegacySandboxModule`, `LEGACY_SANDBOX_COMPILED_FORMAT`), `SANDBOX_LEGACY_RUNTIME_IMPORTS`, the runner's format-0 branch, and the format-0 seeding fallbacks.
- Dropped the legacy `code` column from `sandbox_script` (migration `0002_complete_sandbox_cutover`), made `source`/`compiled_code` required, and set `compiled_format` default to `1`.
- Removed obsolete scaffolding: `src/sandbox-scripts.d.ts` (raw-text declaration), the `sandboxScriptTextPlugin` Vitest loader, the `.oxlintrc.json` `**/*.sandbox.js` override, and the dead `providers/test-utils.ts` (the last `new Function`-based driver harness + import rewriter + helper injector).

### Deviations from the task doc

- **Pre-existing exercise-search bug fixed (approved with user).** The full hermetic suite surfaced a latent bug unrelated to the cutover: the SDK standard search input required a non-empty `query` (`providerSearchInputSchema`, from commit `e198921a3`), but `exercises/preload.ts` bulk-lists exercises with an empty query, so exercise preload seeded nothing and the fitness suites timed out. Fixed at the source by relaxing the search-input `query` to `z.string().trim().catch("")` (browse-all), matching the `free-exercise-db` provider's existing empty-query handling and the lenient `.catch(...)` style of `page`/`pageSize`. Verified: fitness + exercises E2E now green.
- **Repository-wide Turbo check/build is blocked only by `@ryot/graphql`, a pre-existing, unrelated failure.** That package holds only `.gql` query documents (no `.ts` inputs) and carries a stale `moduleResolution: "node"` (removed in the pinned TypeScript); its `tsc`-based `check`/`build` fails in isolation regardless of this task (it was never touched). Every sandbox-relevant package passes Turbo check and build: `@ryot/sandbox-sdk`, `@ryot/sandbox-compiler`, `@ryot/contract`, `@ryot/app-backend`, `@ryot/ts-utils`, `@ryot/transactional`, `@ryot/docs`. Fixing graphql is out of scope (and its `check` additionally needs `backend-graphql` codegen against a live backend to produce inputs).

### Verification summary

- SDK: `check` + tests pass (10 tests).
- Backend: `check` (compile + `deno check` + tsc + oxfmt + oxlint) passes; tests pass (182 files, 1035 tests), including a new "imports every generated built-in module in Deno" test covering all 57 built-ins under production permissions.
- Compiler: `check` passes.
- End-to-end: full hermetic suite passes (514 tests across 73 files, 0 fail); gated live smoke suite remains gated and type-checks.
