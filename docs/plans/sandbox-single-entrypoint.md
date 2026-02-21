# Sandbox Single-Entrypoint Rewrite

Status: completed and verified on 2026-07-26. This was an atomic breaking rewrite for the new backend. User
data compatibility is not required, development databases are wipeable, and no compatibility path
for the current multi-driver model should be added.

The outcome and decided architecture below are the baseline for subsequent plugin-system work. The
phase sections are retained as implementation history, not as pending work.

## Required execution rules

- Do not commit any changes.
- Use subagents to parallelize work. Give each subagent a small, exclusive file surface and explicit
  acceptance criteria.
- All work must happen in the shared current checkout. Do not create or use worktrees.
- Do not give two subagents overlapping ownership. Shared contracts must be stabilized before
  dependent work is dispatched.
- Use fresh verification agents after non-trivial integration waves. A discovery result is not a
  verification result.
- Before writing code in a package, use an `explore` subagent to identify the current local pattern
  to follow, as required by `AGENTS.md`.
- Update affected end-to-end tests under `tests/` in lockstep with implementation. Add focused e2e
  coverage where existing tests do not prove the new provider and execution invariants.
- The complete e2e suite is currently broken. A full-suite failure is not a blocker when it is
  unrelated to this rewrite, but every affected or newly added e2e test must pass in focused runs.
- If any question or unplanned architectural choice appears, stop and ask the project owner. Do not
  make complex decisions independently.
- Keep all documentation aligned with the final code. No references to removed driver maps,
  `driverName`, `driverNames`, script-backed provider identity, or superseded decisions may remain
  in current-state documentation.
- Do not edit legacy Rust migrations. This rewrite belongs to the Drizzle-based app backend.
- Generated sandbox artifacts remain ignored and must not be committed.

## Outcome

The finished system has two distinct concepts:

1. A sandbox provider is a stable logical identity used by entities, provider bindings, related
   entity references, canonical-language metadata, and provider-scoped caches.
2. A sandbox script is one executable entrypoint with one input schema, one output schema, and one
   `run` function.

The runtime executes a script by `scriptId`. It never receives an entrypoint selector. The backend
resolves the exact search, details, resolve, translate, automation, operation, cron, boot, history,
or other script before enqueueing execution.

## Decided architecture

### Logical provider identity

- Add a stable `sandbox_provider` persistence model.
- A provider is identified by its own ID and by a plugin-owned provider slug.
- Provider information such as source and canonical language belongs to the provider, not to each
  executable script.
- Provider-backed entities reference `providerId`, not `sandboxScriptId`.
- Entity uniqueness uses logical provider identity, entity schema slug, and external ID.
- Provider-facing references use `providerSlug`. Fields that currently say `scriptSlug` but mean a
  provider must be renamed rather than retained as aliases.
- Plugin schema bindings link entity schemas to providers.
- Plugin provider declarations explicitly map supported standard operations to script slugs.
- Provider declarations use a nested operation map with this shape:

  ```ts
  {
    slug,
    name,
    information,
    operations: {
      details,
      search?,
      resolve?,
      translate?,
    },
  }
  ```

- Provider-associated scripts declare `providerSlug`; standard provider entrypoints also declare
  `providerOperation`.
- A provider details script is required. Search, resolve, and translate are optional because the
  current catalog contains providers that do not support all operations.
- Provider identity remains stable when plugin source is reingested and executable content hashes
  change.

### Single executable entrypoint

- Every compiled sandbox module exposes one direct entrypoint.
- Generic scripts and operations directly declare input, output, and run.
- Automations and automation policies retain their existing direct run model.
- Standard provider scripts statically declare which provider operation they implement so the SDK
  can supply the correct contract.
- The provider operation is authoring and manifest metadata. It is not carried through an execution
  request and is not used for runtime dispatch inside Deno.
- Custom scripts such as history, trending, cron, and boot use direct generic entrypoints with
  explicit schemas and are referenced directly by their owning manifest section.

### Execution authority

- Sandbox authorization is independent of executable naming.
- Replace the current name-based cron/boot authorization check with a server-created execution
  authority discriminated as user, system, or subscription execution.
- Execution authority uses this strict discriminated union:

  ```ts
  | { type: "user"; userId: UserId }
  | { type: "system" }
  | {
      type: "subscription";
      userId: UserId;
      subscriptionRun: SubscriptionRunContext;
    }
  ```

- Durable execution payloads store this authority union rather than separate authority-related
  optional fields.
- Public enqueueing derives user authority from authentication and cannot select another authority.
- Scheduler boot and cron paths create system authority.
- Automation workflows create subscription authority.
- System-only host functions require system authority.
- Automation-only host functions require subscription authority.
- User-scoped host functions require an authority carrying a user ID.
- Authority is trusted backend state and is never accepted from plugin source or a public request.

### Cache identity

- Provider-associated scripts use `providerId` as their cache namespace.
- Standalone scripts use `scriptId` as their cache namespace.
- Existing user isolation and per-run versus persistent cache behavior remain unchanged.
- Splitting a provider must not break token, metadata, or preload caches that its current drivers
  share.

## Scope inventory

The current production catalog contains 68 executable sandbox source files with 142 entrypoints.
Fifty-one scripts expose multiple entrypoints, and all of them are providers.

| Current entrypoints per script | Script count |
| ------------------------------ | -----------: |
| 1                              |           17 |
| 2                              |           33 |
| 3                              |           15 |
| 4                              |            1 |
| 5                              |            2 |

After the rewrite, the production catalog should contain 142 single-entrypoint sandbox scripts,
subject only to deliberate removal of dead behavior discovered and approved during implementation.

Primary workspace surfaces:

- `packages/sandbox-sdk`
- `packages/sandbox-compiler`
- `packages/plugin-kit`
- `packages/contract`
- `apps/app-backend`
- `plugins/media`
- `plugins/fitness`
- `tests`

## Phase 0: Baseline and contracts

Before implementation:

- Record the currently affected focused unit, integration, and e2e tests.
- Record existing unrelated e2e failures separately so they cannot be mistaken for regressions.
- Confirm the Drizzle migration can be regenerated rather than adding a compatibility migration.
- Confirm generated sandbox output remains ignored.
- Search for all current occurrences of `driverName`, `driverNames`, `.drivers`,
  `defineProviderDriver`, provider-facing `scriptSlug`, `sandboxScriptId`, and documentation that
  explains the old model.
- Turn the search result into a checklist owned by the integration orchestrator.

Stop and ask if development data unexpectedly must be retained or if an active durable sandbox job
cannot be discarded.

## Phase 1: Provider persistence and manifest contracts

### Database model

- Add the `sandbox_provider` table with ID, provider slug, plugin ownership, name, provider
  information, and timestamps required by repository conventions.
- Add the provider relationship to `sandbox_script` for provider-associated entrypoints.
- Replace `entity.sandboxScriptId` with `entity.providerId`.
- Replace entity indexes and uniqueness constraints that use script identity with provider identity.
- Update Drizzle relations and inferred row types.
- Regenerate the initial Drizzle migration and metadata according to the current greenfield database
  convention. Do not modify Rust SQLx migrations.

### Plugin manifest model

- Add explicit logical provider declarations.
- Give each provider its standard operation-to-script mapping.
- Change schema-provider bindings from script references to provider references.
- Allow scripts associated with a provider but invoked through another manifest section, such as
  Free Exercise DB boot, to retain the provider cache namespace without pretending to be a
  standard provider operation.
- Validate unique provider slugs, unique standard operation assignments, existing script
  references, and one-provider-per-script membership.
- Remove provider information duplication from individual script declarations.

### Contract model

- Introduce the branded provider ID and provider-facing schemas at the client-safe contract
  boundary where they cross APIs or durable messages.
- Rename fields that semantically identify providers from `scriptSlug` to `providerSlug`.
- Do not rename automation binding fields that genuinely continue to identify executable scripts.
- Update related-entity, import, entity, and test-support contracts accordingly.

Phase gate:

- Manifest and schema tests prove valid and invalid provider mappings.
- Database constraints prove entity uniqueness by provider.
- No compatibility fields or dual-read paths exist.

## Phase 2: Sandbox SDK and compiler

### SDK

- Replace `GenericScriptDefinition.drivers` with one direct input, output, and run entrypoint.
- Change `defineScript` and `defineOperation` to construct direct definitions.
- Replace `defineProviderDriver` plus `defineProvider({ drivers })` with one direct provider
  definition API.
- Preserve the standard provider search, details, resolve, and translate schemas as the source of
  truth.
- Keep automation and automation-policy definitions direct and align their compiled shape with the
  new common entrypoint contract where practical.
- Update SDK type-level tests to prove operation-specific input and output inference.

### Compiler

- Remove top-level driver declaration discovery.
- Remove drivers-object traversal and exposed-key validation.
- Remove `driverNames` from source inspection and the compiler protocol.
- Validate exactly one direct default definition.
- Validate definition kind and provider operation against the declared manifest.
- Preserve manifest inspection, diagnostics, multi-file compilation, source maps, limits, and
  approved dependency handling.
- Add diagnostics that clearly reject obsolete multi-driver definitions.
- Update compiler fixtures and builtins without adding a legacy compilation path.

Phase gate:

- SDK tests pass.
- Compiler tests pass.
- Type-level tests reject mismatched provider operation contracts.
- Compiled output contains one direct entrypoint and no driver-name metadata.

## Phase 3: Plugin ingestion and provider resolution

- Make ingestion create or resolve logical providers before persisting provider-associated scripts.
- Keep provider IDs stable across plugin reingestion while compiled script rows remain
  content-addressed.
- Persist provider membership on each relevant script.
- Stop adding `driverNames` to stored script metadata.
- Update plugin repository normalization and loader snapshots.
- Replace schema-script resolution with schema-provider resolution.
- Add explicit runtime resolver operations for search, details, resolve, and translate scripts.
- Keep direct executable resolution for automation, operation, cron, boot, and other manifest-owned
  scripts.
- Make missing optional provider operations return typed, contextual failures.
- Update plugin uninstall and dependency checks to account for entities referencing providers.
- Update provider listing APIs and sandbox host functions to expose logical provider identity and
  the executable IDs actually needed by callers.

Prefer explicit resolver methods over passing arbitrary operation strings through business
workflows. Internal maps may use operation keys, but generic runtime execution may not.

Phase gate:

- Provider IDs survive plugin source reingestion.
- Active script resolution selects the latest compiled entrypoint for each provider operation.
- Missing mappings fail during plugin validation or through a typed unsupported-operation result,
  never through Deno property lookup.

## Phase 4: Runtime execution and authorization

- Remove `driverName` from public enqueue bodies, test-support bodies, durable execution payloads,
  runtime service inputs, observability attributes, runner payloads, and generated runner types.
- Remove `driverNames` from script metadata and persistence schemas.
- Change the Deno runner to validate and execute the direct definition entrypoint.
- Preserve input decoding, output decoding, Effect execution, structured phase errors, source-map
  sanitization, timing, logs, process isolation, and resource limits.
- Replace user ID plus driver-name authorization inference with the decided execution-authority
  union.
- Update host-function binding and type narrowing around authority.
- Derive the cache namespace on the backend from `providerId` or `scriptId`; do not let scripts
  choose it.
- Update runtime documentation and runner generation in the same phase.

Security gate:

- User execution cannot receive system host functions.
- Subscription execution cannot receive system host functions.
- Non-subscription execution cannot receive automation-only host functions.
- Only trusted scheduler boot and cron paths receive system authority.
- Public and test-support payloads cannot forge authority.

## Phase 5: Backend workflow cutover

Update each business path to resolve the exact executable before enqueueing it:

- Entity search resolves a provider search script.
- Provider population resolves a provider details script.
- Import identifier resolution resolves a provider resolve script.
- Translation resolves a provider translate script.
- Related entities resolve `providerSlug` to `providerId`.
- Child and related entities persist provider provenance.
- Canonical language reads from provider information.
- Cron and boot dispatch directly referenced scripts with system authority.
- Plugin operations dispatch directly referenced operation scripts.
- Automations and policies dispatch directly referenced automation scripts with subscription
  authority.
- YouTube Music history dispatches its dedicated script directly.
- Test-support execution dispatches a script directly and cannot choose a named entrypoint.

Update all repositories, services, workflows, durable message schemas, fixtures, and tests in the
same module slice. Do not leave temporary generic operation selectors in workflow payloads.

Phase gate:

- Search to details population works using separate scripts from one provider.
- Resolve to details population preserves one provider identity.
- Translation resolves a sibling provider entrypoint without changing entity provenance.
- Existing entities use active reingested provider scripts.
- Related-provider relationships resolve through provider slugs.

## Phase 6: Split all sandbox scripts

Use thin `.sandbox.ts` wrappers around shared implementation modules. Do not duplicate API clients,
response parsing, authentication, schemas, or provider transformation logic merely to satisfy the
one-entrypoint file rule.

Recommended filenames use an operation suffix:

```text
tmdb.search.sandbox.ts
tmdb.details.sandbox.ts
tmdb.resolve.sandbox.ts
tmdb.translate.sandbox.ts
tmdb.trending.sandbox.ts
```

Split in descending complexity so the first migrations establish reusable patterns:

1. Movie TMDB and show TMDB, currently five entrypoints each.
2. YouTube Music, currently four entrypoints.
3. The 15 three-entrypoint providers.
4. The 33 two-entrypoint providers.
5. Existing single-entrypoint scripts, compiler fixtures, kernel scripts, operations, automations,
   policies, cron, and boot definitions converted to the direct SDK shape.

Special behavior that must remain covered:

- `media-trending` composes TMDB trending implementations.
- `metadata-lookup` composes TMDB search implementations in-process.
- Free Exercise DB boot preloads cache consumed by search and details.
- YouTube Music history remains a sandbox source-ingestion exception.
- Provider details can return related providers by logical provider slug.
- TMDB, TVDB, Spotify, IGDB, and other shared clients retain their authentication and cache
  behavior.
- Per-entrypoint capabilities and required app-config keys must be narrowed where possible rather
  than copied blindly from the former combined manifest.

Catalog generation must discover every new entrypoint. Generated registry modules and runner output
remain ignored and must not be staged.

Phase gate:

- Production has one entrypoint per sandbox script.
- The expected catalog contains 142 executable scripts unless an approved deletion changes the
  count.
- Every plugin and kernel script compiles.
- Provider package tests pass for every split provider touched by a work batch.

## Phase 7: End-to-end tests

Update `tests/` as a first-class implementation surface, not as deferred cleanup.

### Fixtures

At minimum, inspect and update:

- `tests/src/fixtures/sandbox-provider.ts`
- `tests/src/fixtures/sandbox-source.ts`
- `tests/src/fixtures/sandbox.ts`
- `tests/src/fixtures/test-plugin.ts`
- `tests/src/fixtures/entity-schemas.ts`
- `tests/src/fixtures/index.ts`
- `tests/src/seed-script.ts`

Do not broadly refactor `tests/src/seed-script.ts`; make only changes required by the new contracts,
as directed by `tests/AGENTS.md`.

The provider fixture must install a logical provider plus separate executable scripts and return
provider identity separately from operation script IDs. Keep fake providers hermetic and continue
using the real plugin ingestion endpoint.

### Affected suites

Run and update at least these focused suites:

- `tests/src/tests/kernel/sandbox/enqueue.test.ts`
- `tests/src/tests/kernel/sandbox/sandbox.test.ts`
- `tests/src/tests/kernel/sandbox/async-flow.test.ts`
- `tests/src/tests/kernel/sandbox/cache.test.ts`
- `tests/src/tests/kernel/plugins/plugins.test.ts`
- `tests/src/tests/kernel/plugins/operations.test.ts`
- `tests/src/tests/kernel/entity-import/entity-import.test.ts`
- `tests/src/tests/kernel/entity-schemas/search-import.test.ts`
- `tests/src/tests/kernel/entity-interest/population-dispatch.test.ts`
- `tests/src/tests/plugins/media/media-monitoring/media-monitoring.test.ts`
- `tests/src/tests/plugins/media/media-monitoring/association-detectors.test.ts`
- `tests/src/tests/plugins/media/media-monitoring/association-detectors-variants.test.ts`
- `tests/src/tests/plugins/media/media-monitoring/media-entity-update-signals.test.ts`
- `tests/src/tests/kernel/god-mode/delete-user.test.ts`
- `tests/src/tests/kernel/system/observability.test.ts`

Add focused e2e tests if the existing suites do not prove:

- One provider's search and details scripts cooperate through provider identity.
- Entity uniqueness survives plugin script reingestion.
- Provider cache data is shared across separate entrypoint scripts and isolated across users and
  providers.
- Resolve, details, and translate dispatch to distinct scripts.
- Public sandbox execution cannot select or forge another entrypoint or execution authority.

Run affected e2e files explicitly from `tests/`, for example:

```bash
bun run test -- src/tests/kernel/sandbox/enqueue.test.ts
bun run test -- src/tests/kernel/plugins/plugins.test.ts
bun run test -- src/tests/kernel/entity-import/entity-import.test.ts
```

The entire e2e suite should still be attempted at the final gate. If it fails, record the failing
tests and demonstrate that failures are pre-existing or unrelated. Every affected and newly added
test must be green.

## Phase 8: Cleanup and documentation

- Remove obsolete SDK driver types and helpers.
- Remove compiler driver inspection and protocol fields.
- Remove plugin validation that checks exposed driver names.
- Remove persistence branches for `driverNames`.
- Remove runner lookup errors and driver terminology where it means an executable entrypoint.
- Remove temporary migration helpers and transitional types.
- Run repository searches for removed symbols and inspect every remaining match.
- Use the `codebase-cleanup` skill over all touched files and directly affected modules.

Update current-state documentation, including at minimum:

- `apps/app-backend/src/lib/infrastructure/sandbox-runtime/README.md`
- `apps/app-backend/AGENTS.md`
- `packages/plugin-kit/README.md`
- `tests/AGENTS.md`
- `plugins/media/AGENTS.md`
- Any affected module-local `AGENTS.md` or README discovered during implementation
- Existing plugin-system plans or tasks that still prescribe the removed driver model

Documentation requirements:

- Describe only the final direct-entrypoint runtime and logical provider model.
- Replace examples using `drivers` maps or `defineProviderDriver`.
- Replace statements that entities use sandbox script provenance with provider provenance.
- Document provider-scoped cache behavior and execution authority.
- Remove obsolete migration instructions, historical alternatives, and superseded decisions rather
  than leaving caveats such as "previously" or "legacy."
- Delete completed planning/task documents that would otherwise remain an authoritative-looking
  description of removed code, or rewrite them so they accurately describe current state.
- At completion, remove this plan or convert it into current-state architecture documentation.

## Subagent execution topology

The orchestrator owns architecture, dependency ordering, integration, conflict resolution, and the
final decision to advance each phase. Subagents receive stable contracts, exclusive paths, explicit
done criteria, and exact verification commands.

Suggested small-surface waves:

| Wave | Subagent surface                                       | Dependency                                |
| ---- | ------------------------------------------------------ | ----------------------------------------- |
| 1    | `packages/plugin-kit` manifest/provider schemas            | Decided provider shape                    |
| 1    | `packages/contract` provider and sandbox schemas           | Decided provider and authority shapes     |
| 1    | Drizzle provider/entity tables and generated migration | Decided persistence shape                 |
| 2    | `packages/sandbox-sdk` direct definitions and type tests   | Wave 1 interfaces stable                  |
| 2    | Plugin ingestion/repository provider persistence       | Wave 1 persistence stable                 |
| 3    | `packages/sandbox-compiler` direct-entrypoint inspection   | SDK shape stable                          |
| 3    | Runtime runner and execution service                   | SDK compiled shape and authority stable   |
| 3    | Plugin resolver provider-operation lookup              | Provider persistence and manifests stable |
| 4    | Entity import/population modules                       | Resolver APIs stable                      |
| 4    | Translation and entity-interest modules                | Resolver APIs stable                      |
| 4    | Scheduler, automations, operations, and integrations   | Execution payload stable                  |
| 4    | `tests/` shared fixtures                               | Contract and manifest APIs stable         |
| 5    | TMDB movie/show split                                  | SDK/compiler/runtime integrated           |
| 5    | YouTube Music split                                    | SDK/compiler/runtime integrated           |
| 5    | Fitness provider and boot split                        | Cache namespace integrated                |
| 6    | Media anime/manga/book providers                       | First split patterns verified             |
| 6    | Media movie/show/podcast providers excluding TMDB      | First split patterns verified             |
| 6    | Media music/video-game/visual-novel providers          | First split patterns verified             |
| 6    | Person providers                                       | First split patterns verified             |
| 6    | Company and media-group providers                      | First split patterns verified             |
| 7    | Focused backend tests for each changed module          | Corresponding implementation integrated   |
| 7    | Focused e2e suites grouped by domain                   | Shared e2e fixtures integrated            |
| 8    | Documentation audit and cleanup                        | Functional verification complete          |
| 8    | Fresh outcome verification                             | All changes integrated                    |

Do not dispatch all provider splits before the TMDB, YouTube Music, and fitness reference patterns
are integrated and verified. Small provider batches should contain only closely related directories
and their colocated tests.

## Verification commands

Use Turbo for workspace checks as required by repository guidance. Run tests from their individual
package directories.

Core checks:

```bash
bun turbo --filter=@ryot/sandbox-sdk check
bun turbo --filter=@ryot/sandbox-compiler check
bun turbo --filter=@ryot/plugin-kit check
bun turbo --filter=@ryot/contract check
bun turbo --filter=@ryot/plugin-media check
bun turbo --filter=@ryot/plugin-fitness check
bun turbo --filter=@ryot/app-backend check
bun turbo --filter=@ryot/tests check
```

Package tests:

```bash
# Run from packages/sandbox-sdk
bun run test

# Run from packages/sandbox-compiler
bun run test

# Run from packages/plugin-kit
bun run test

# Run from plugins/media
bun run test

# Run from plugins/fitness
bun run test

# Run from apps/app-backend
bun run test
```

Generation checks:

```bash
# Run from apps/app-backend
bun run db:generate
bun run sandbox:compile-runner
bun run sandbox:check-runner
```

Do not treat a successful generation command as permission to commit ignored generated output.

## Implementation notes

Completed on 2026-07-26:

- Added persistent logical providers and provider provenance. Reingestion preserves provider IDs
  while activating newly compiled operation scripts.
- Replaced multi-entrypoint definitions with 142 direct production scripts: 136 media, 5 fitness,
  and 1 kernel script.
- Provider manifests explicitly map details, search, resolve, and translate operations. Schema
  bindings target providers; executable manifest sections target scripts.
- Runtime and durable payloads execute by `scriptId` only. The backend resolves the exact script
  before enqueueing it.
- Added trusted `user`, `system`, and `subscription` execution authority. As owner-approved during
  implementation, public plugin operations support only `user` and `integration` authentication;
  the proposed `admin` operation mode was removed. System execution can emit signals but cannot
  send subscription notifications.
- Provider-associated scripts share provider-scoped caches; standalone scripts remain
  script-scoped. Executing-user and lifecycle isolation remain intact.
- Standard provider scripts cannot receive global-write capabilities, including during
  scheduler-owned provider refreshes. Only generic scripts reached through trusted scheduler paths
  receive system capabilities.
- Final verification passed all package checks, 954 backend tests, and 491 e2e tests across 78
  files. A fresh outcome verifier returned `CONFIRMED`. No commits were created.

The broader current-state documentation sweep remains part of plugin-system Phase 4. This plan and
the active plugin-system plans have been updated now so future implementation resumes from the
correct runtime baseline.

## Final acceptance criteria

- [x] Every production sandbox script has exactly one executable entrypoint.
- [x] Runtime execution accepts a script ID and has no entrypoint selector.
- [x] No `driverName` or `driverNames` field remains in runtime, contract, compiler, metadata, or
      tests.
- [x] No SDK or production script uses a `drivers` map or `defineProviderDriver`.
- [x] Logical providers are persisted separately from executable scripts.
- [x] Provider-backed entities store provider identity and deduplicate by provider.
- [x] Provider reingestion changes active script versions without changing provider identity.
- [x] Search, details, resolve, and translate resolve to distinct scripts before execution.
- [x] Provider caches remain shared across that provider's split scripts and isolated by user and
      provider.
- [x] Sandbox host-function authorization uses trusted execution authority, not script names.
- [x] All plugin and kernel scripts compile through the production ingestion compiler.
- [x] Affected SDK, compiler, plugin-kit, plugin, and backend tests pass.
- [x] Every affected and newly added `tests/` e2e test passes in focused runs.
- [x] The full e2e suite passes with no remaining failures to classify.
- [x] Generated ignored artifacts are not staged.
- [x] No commits were created.
- [ ] Current-state documentation outside this plan set is updated during plugin-system Phase 4.
- [x] This migration plan records the completed implementation and the baseline for later work.

## Stop conditions

Stop implementation and ask the project owner if any of the following occurs:

- Existing data must be preserved after all.
- A provider cannot be represented by one stable identity and explicit operation scripts.
- A script needs runtime entrypoint selection to preserve required behavior.
- A provider operation needs a new standard contract beyond search, details, resolve, and translate.
- Cache sharing cannot be represented safely by provider identity.
- A public caller appears to require system or subscription authority.
- Durable in-flight execution data cannot be discarded or drained.
- Splitting a script requires duplicating substantial implementation rather than extracting a shared
  module.
- Documentation conflicts about the intended current architecture.
- Any other complex decision is required that this plan does not settle.
