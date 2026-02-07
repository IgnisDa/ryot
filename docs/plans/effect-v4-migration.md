# Effect v4 Migration Plan

Status: Planned

## 1. Goal

Migrate every in-scope Ryot workspace from Effect v3 to Effect v4 using focused,
repeatable codemods followed by explicit v4-native rewrites.

This is a greenfield project. Breaking changes are acceptable. Do not add
compatibility wrappers, dual v3/v4 APIs, deprecated aliases, or temporary
behavior-preservation layers solely to ease migration.

Target one exact Effect beta across the in-scope ecosystem. The currently
researched target is `4.0.0-beta.102`. Confirm that target before changing any
dependency. Never use a floating `@beta` range during migration.

## 2. Authority

Use migration information in this order:

1. Source and declarations for the exact target release.
2. Official migration material in `/tmp/effect-migration`:
   - `MIGRATION.md`
   - `migration/v3-to-v4.md`
   - `migration/annotations/`
   - `migration/services.md`
   - `migration/schema.md`
   - `migration/error-handling.md`
   - `packages/effect/SCHEMA.md`
3. Current Ryot source, checks, and tests.
4. Commit `a508aa41502620e5b30591e668a8b93c441f59bd` as a non-authoritative
   source of possible search terms only.

Do not make a decision from the prior Ryot migration plan without independent
confirmation from exact-version Effect source or official migration material.

## 3. Scope

### 3.1 Excluded

Do not edit, codemod, format, lint, test, or use as an acceptance gate:

- `apps/app-client-backup/**`
- `apps/frontend/**`
- `libs/graphql/**`

`apps/app-client-backup/package.json` may retain Effect v3 and
`@effect/platform` v3. Duplicate v3 and v4 entries in `bun.lock` are expected.
Do not add compatibility code to `@ryot/contract` for either excluded client.

### 3.2 Direct Effect consumers

Update dependencies and source in:

- `@ryot/app-backend`
- `@ryot/app-client`
- `@ryot/website`
- `@ryot/browser-extension`
- `@ryot/contract`
- `@ryot/config`
- `@ryot/sandbox-sdk`
- `@ryot/plugin-kit`
- `@ryot/sandbox-compiler`
- `@ryot/plugin-fitness`
- `@ryot/plugin-media`
- `@ryot/tests`

All other non-excluded workspaces must pass their applicable checks and builds
because shared contract, SDK, and plugin types cross workspace boundaries.

### 3.3 Generated and embedded source

Do not transform generated output or TypeScript embedded in strings with the
generic AST codemods. Migrate source templates in dedicated bounded slices and
regenerate their output. Initial exclusions include:

- `runner.generated.ts`
- build output under `dist/`, `build/`, and similar output directories
- embedded sandbox source strings
- `.turbo/` and `node_modules/`

`apps/app-backend/src/lib/infrastructure/sandbox-runtime/dependencies.ts` is a
maintained source template containing embedded Effect imports. Migrate it
explicitly; do not treat it as generated output.

## 4. Working Protocol

Work in the current checkout. Do not create a separate worktree.

Concurrent documentation-only changes outside this plan are expected. Do not
edit, stage, revert, or treat them as migration issues unless they overlap a
file required by the active slice.

Before each implementation step:

1. Confirm `git status --short` contains only expected migration changes and
   unrelated documentation-only changes.
2. Assign every implementation edit to one small, bounded subagent.
3. Give that subagent exact directories, APIs, exclusions, and verification
   commands. Do not issue repository-wide omnibus tasks.
4. Do not run concurrent implementation subagents that can edit overlapping
   files.

Each implementation subagent must run its assigned codemod fixture,
idempotency, static, formatting, focused check, or focused test commands before
handoff. Package `check` commands can edit files through `oxfmt --write` and
`oxlint --fix`; those edits remain part of the implementation subagent's slice.

After each implementation subagent finishes:

1. Inspect its complete diff.
2. Confirm excluded and generated paths were untouched.
3. Launch a separate, narrow read-only verifier subagent for every slice.
4. If verification requests any change, stop and ask the user before resuming
   implementation.
5. Record exact commands and results before moving to the next slice.

Use logical commits only after the corresponding phase gate is satisfied.
Never hide a failing gate in a later cleanup commit.

## 5. Stop Conditions

Stop immediately and ask the user for clarification when any issue appears,
including:

- Exact-version source and migration guidance disagree.
- A replacement is unannotated or has unclear semantics.
- A codemod encounters an unsupported syntax shape.
- Any install, codemod, generation, formatting, lint, check, test, build, or
  other command returns a non-zero result.
- An excluded workspace becomes necessary for an in-scope acceptance gate.
- The target beta or matching ecosystem package is unavailable.
- An unexpected code file changes or a concurrent edit conflicts with the
  slice.
- A proposed fix requires compatibility behavior or product semantics not
  specified here.

Do not guess, silently broaden scope, weaken tests, skip a required gate, or
apply a speculative workaround.

## 6. Codemod Design

Add a minimal TypeScript-aware codemod suite under `scripts/effect-v4/` using
`jscodeshift` with its TypeScript parser. Keep one transform per API family and
fixture-test each supported syntax shape.

Every transform must:

- Operate only on in-scope paths.
- Resolve imports and local aliases before changing namespace members.
- Preserve type-only imports.
- Split imports when symbols move to different v4 modules.
- Avoid global text replacement.
- Emit a warning and leave code unchanged for ambiguous input.
- Be idempotent.
- Report transformed and skipped files.

The suite must provide dry-run and write modes. Add a guard that reports
remaining v3 imports and removed APIs in in-scope source.

Every deterministic or repeated migration shape must be attempted as a
codemod first. Manual rewrites are limited to one-off semantic integrations or
sites that a codemod reports as unsupported. An unsupported site is a stop
condition and requires user clarification before manual changes.

## 7. Migration Phases

### Phase 0: Baseline and codemod fixtures

Goal: establish a clean baseline and executable migration harness without
changing application behavior.

Steps:

1. Confirm clean starting status.
2. Confirm exact target Effect version and matching package versions.
3. Capture representative fixtures for every currently observed syntax shape.
4. Add codemod runner, focused transforms, fixture tests, and idempotency tests.
5. Run current checks and non-E2E tests before dependency changes:

   ```bash
   bun turbo check --only --filter='!@ryot/app-client-backup' --filter='!@ryot/frontend' --filter='!@ryot/graphql'
   bun turbo test --only --filter='!@ryot/tests' --filter='!@ryot/app-client-backup' --filter='!@ryot/frontend' --filter='!@ryot/graphql'
   ```

6. Run only individually selected E2E files needed to establish baseline for
   affected domains.

Phase gate:

- Codemod fixtures pass under the v3 dependency graph.
- Current non-E2E checks and tests are green, or any pre-existing failure has
  been reported to and resolved with the user.
- No production source has changed.

### Phase 1: Dependencies and import relocation

Goal: create one coherent v4 dependency graph for every in-scope workspace.

Steps:

1. Upgrade `effect` to the exact target version in all direct consumers.
2. Upgrade retained ecosystem packages to the same exact version:
   - `@effect/platform-bun`
   - `@effect/sql-pg`
   - `@effect/opentelemetry`
   - `@effect/vitest`
3. Replace `@effect-atom/atom-react` with the exact-version
   `@effect/atom-react` package in app-client and codemod all imports to the new
   package name.
4. Remove consolidated packages from in-scope manifests:
   - `@effect/platform`
   - `@effect/workflow`
   - `@effect/cluster`
   - `@effect/experimental`
5. Run the import codemod, including these destinations:
   - stable modules from `effect`
   - HTTP from `effect/unstable/http`
   - HttpApi from `effect/unstable/httpapi`
   - workflow from `effect/unstable/workflow`
   - cluster from `effect/unstable/cluster`
   - persistence from `effect/unstable/persistence`
   - process APIs from `effect/unstable/process`
6. Install once after all in-scope manifests have changed.
7. Align the sandbox runtime's independent Effect pin in
   `sandbox-runtime/deno.json` and `sandbox-runtime/dependencies.ts`, including
   the runtime filename, with the selected exact v4 version.
8. Confirm the excluded backup still owns any remaining direct v3 dependency.

Phase gate:

- In-scope manifests use one exact Effect ecosystem version.
- No consolidated v3 package import remains in in-scope source.
- Excluded manifests and source are unchanged.

### Phase 2: Core Effect, services, layers, and Vitest

Goal: migrate dependency injection, verified core API renames, and test APIs
needed by later package gates.

Codemod these observed forms:

- `Effect.Service` to `Context.Service`.
- `effect` and `scoped` service options to `make`.
- `sync` service options to `make: Effect.sync(...)`.
- Explicit `static readonly layer = Layer.effect(this, this.make)`.
- Service `dependencies` to explicit `Layer.provide` composition.
- Known service `.Default` references to `.layer`.
- Old class-style `Context.Tag` declarations to `Context.Service`.
- `Effect.either` to `Effect.result`.
- `Either` namespace APIs to `Result` namespace APIs.
- Verified `Effect`, `Layer`, `Scope`, and error-handling renames.
- `it.scoped` to `it.effect`.
- `it.scopedLive` to `it.live`.
- Removal of no-op `addEqualityTesters` setup files and config entries.
- Test support types that expose or ban removed Vitest methods.

Do not globally replace `.left` and `.right`. Rewrite only when ownership is
proven from an imported Result API or a directly traceable initializer.

Phase gate:

- Service and layer fixture tests pass.
- Vitest codemod fixtures pass.
- No in-scope `Effect.Service` or service `.Default` remains.
- Codemods are idempotent and static guards find no migrated v3 forms.
- Package compilation is explicitly deferred until each package's complete
  Effect surface has migrated.

### Phase 3: Schema, HttpApi contract, Config, and SDKs

Goal: migrate shared data definitions before their consumers.

Apply separate transforms for:

- `Literal`, `Union`, `Record`, and optional/default constructor changes.
- `annotations` to `annotate`.
- `filter` and named constraints to v4 `check` APIs.
- `TaggedError` to `TaggedErrorClass`.
- Decode and encode Effect combinator renames.
- `parseJson` to `fromJsonString`.
- `decodeUnknownEither` to the selected v4 `Result` or `Exit` API.
- `transform`, `transformOrFail`, and `compose` to v4 transformations.
- `ParseResult` errors and formatting to v4 Schema errors and issues.
- Config integer, provider, error, and `mapOrFail` changes.
- Contract-owned HttpApi endpoints, errors, middleware declarations, schema
  helpers, and generated-client request types.
- Embedded Effect imports and removed Schema modules in
  `sandbox-runtime/dependencies.ts`.

Migrate and verify in dependency order:

1. `@ryot/sandbox-sdk`
2. `@ryot/sandbox-compiler`
3. `@ryot/contract`
4. `@ryot/config`
5. `@ryot/plugin-kit`
6. fitness and media plugins

Apply Schema codemods to all in-scope source during this phase, including
backend call sites. Complete and verify each shared package before checking its
dependents. Backend compilation remains deferred until its HttpApi, workflow,
process, and provider surfaces migrate.

Phase gate:

- Each package passes its normal check and non-E2E test suite.
- Schema round-trip and error assertions remain meaningful.
- No `ParseResult` import remains in in-scope source.

### Phase 4: HttpApi runtime and application consumers

Goal: implement the migrated HTTP contract and update application consumers
using native v4 APIs.

Steps:

1. Review every transformed contract endpoint against exact-version HttpApi
   source.
2. Assign backend handlers, API-wide errors, middleware, security, scalar
   documentation, router, and server assembly rewrites to bounded semantic
   slices.
3. Add and run focused codemods for application consumers:
   - app-client HTTP and KeyValueStore APIs
   - app-client imports from `@effect-atom/atom-react` to `@effect/atom-react`
   - website FetchHttpClient and error handling
   - browser extension dependency cleanup

Do not preserve the v3 fluent DSL through local wrappers.

Phase gate:

- HttpApi runtime codemod fixtures and static guards pass.
- Backend HttpApi changes pass independent verifier review; backend compilation
  remains deferred until Phase 5 completes its remaining Effect surfaces.
- App-client checks, tests, and build pass.
- Website and browser-extension checks and builds pass.

### Phase 5: Workflow, persistence, process, and providers

Goal: complete backend infrastructure migration using v4-native integrations.

First add and run codemods for deterministic forms:

- `Workflow.make` positional tags.
- Workflow service `Type` projections to `Service`.
- Workflow `poll` results from `undefined` to `Option`.

Then assign each remaining semantic integration to its own bounded subagent:

- PersistedQueue Redis through the generic v4 Redis service.
- `SingleRunner` Crypto requirements.
- `Command` and `CommandExecutor` to `ChildProcess` and
  `ChildProcessSpawner`.
- OpenTelemetry through v4 `NodeSdk`, exporters, and `OtelTracer`.
- Bun services, runtime options, and server layers.
- `Effect.async` and `Stream.asyncPush` callback migrations.

Phase gate:

- Backend check passes after every backend Effect surface has migrated.
- Workflow, persistence, process, and provider focused tests pass.
- Full backend tests and E2E remain deferred until generated output is updated.

### Phase 6: Generated output and cleanup

Goal: regenerate artifacts, remove migration residue, and run normal test
suites.

Steps:

1. Regenerate the sandbox runner from migrated source.
2. Run `sandbox:check-runner` against the migrated `deno.json` import map.
3. Regenerate other generated artifacts from migrated source.
4. Run all codemods again and require zero diff.
5. Run the v3 import and removed-API guard.
6. Remove temporary migration diagnostics not needed after completion.
7. Run every normal non-E2E test suite without selecting individual test files.

Phase gate:

- Every normal non-E2E test suite passes.
- Generated output matches migrated source.
- Codemods are idempotent.
- Excluded paths remain untouched.

### Phase 7: Final verification

Goal: prove every in-scope workspace against the complete v4 graph.

Assign this phase's commands to one bounded verification-runner subagent. Since
checks and builds can format or regenerate tracked files, launch one final
read-only verifier subagent after every command completes. It must inspect the
post-command diff before acceptance.

Run checks and builds with explicit exclusions:

```bash
bun turbo check --only --filter='!@ryot/app-client-backup' --filter='!@ryot/frontend' --filter='!@ryot/graphql'
bun turbo build --only --filter='!@ryot/app-client-backup' --filter='!@ryot/frontend' --filter='!@ryot/graphql'
```

Run all non-E2E test suites normally while excluding the E2E package:

```bash
bun turbo test --only --filter='!@ryot/tests' --filter='!@ryot/app-client-backup' --filter='!@ryot/frontend' --filter='!@ryot/graphql'
```

Never run the complete E2E package in one Vitest invocation. Discover current
files under `tests/src/tests/**/*.test.ts`, excluding
`media-population-operational-gate.test.ts`, then run one file per command:

```bash
bun turbo --filter=@ryot/tests test --only -- src/tests/<area>/<file>.test.ts
```

Run E2E files sequentially. Each invocation must contain exactly one test file.
Stop on the first failure and ask the user before continuing or changing code.
Do not use a directory, glob, or omitted file argument.

The operational E2E test is prohibited. Never run this file and never set
`RUN_OPERATIONAL_GATES` during migration:

```bash
tests/src/tests/plugins/media/imports/media-population-operational-gate.test.ts
```

Run the live-provider smoke file explicitly and do not treat a successful
invocation containing skipped tests as a pass:

```bash
RUN_LIVE_PROVIDER_TESTS=1 bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/smoke/providers-live-smoke.test.ts'
```

The live provider smoke test requires outbound provider access and a TMDB
access token. If it cannot be enabled, stop and ask the user for the required
environment or an explicit waiver naming the file and reason.

## 8. Final Acceptance

Migration is complete when:

- Every non-excluded workspace passes its applicable check and build.
- Every non-E2E test suite passes normally.
- Every permitted E2E file passes in an individual invocation, except the live
  provider smoke file when an explicit user waiver records its filename and
  reason. The prohibited operational E2E file is not an acceptance gate.
- All in-scope Effect ecosystem dependencies use the selected exact v4 beta.
- Remaining direct v3 dependencies belong only to excluded source.
- No consolidated v3 import or removed v3 API remains in in-scope source.
- Codemods are idempotent and report no unsupported in-scope syntax.
- Generated output has been regenerated from v4 source.
- `apps/app-client-backup/**`, `apps/frontend/**`, and `libs/graphql/**` have no
  migration diff.
- No compatibility shim was introduced for excluded or v3 code.
- All verification commands and results are recorded accurately.
