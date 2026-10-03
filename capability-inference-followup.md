# Follow-up: generated sandbox capabilities

## Timing and goal

Implement this after `new-ingestion.md` is complete and its validation gates pass. Extend the execution analysis and metadata pipeline produced by that work; do not restart or replace the ingestion implementation.

Remove capability lists from sandbox source manifests. Derive each executable's capabilities from its SDK usage, persist those facts in compiled metadata, and use them for runtime grants and validation.

This is an authoring and compiler improvement. It does not remove the capability model or change which subjects, plugin scopes, executable kinds, resources, or operations Ryot authorizes.

## Scope decisions

- Authors declare executable identity, kind, input/output contracts, and other author-owned fields. They do not declare capability arrays.
- Capabilities remain explicit, deterministic fields in generated executable metadata and persisted script records.
- Extend the existing symbol-based execution analyzer. Do not introduce a second TypeScript analysis pipeline, runtime source analysis, or a general-purpose effect system.
- Generate local capabilities per executable, including its ordinary shared helper code. Do not inherit grants from child executables.
- Support resolved method references and normal helper forwarding. Preserve stricter analysis rules for configuration, OAuth, and executable calls when their arguments determine dependency facts.
- Preserve policy-safe restrictions, workflow restrictions, private/system plugin rules, subject authorization, filesystem grants, budgets, and external-idempotency validation.
- Replace authored lists directly across shipped plugins, kernel scripts, private-plugin fixtures, and tests. Do not add manual overrides, compatibility paths, or generated per-script TypeScript declaration files.
- Keep existing artifact, manifest, compiler, protocol, backup, and API version constants unchanged.
- Do not change ingestion lifecycle, payload retention, append-only import semantics, selective-retry scope, or blocked-delivery behavior from the preceding plan.

## Research basis and prerequisite checks

The capability research inspected the in-progress ingestion implementation in the `importer-improvements` worktree after commit `e3d27ad626`. Those working changes are not a frozen implementation baseline. At the start of this follow-up, inspect the completed implementation and update file-level details to match it.

The following structures already exist in the implementation being built:

| Structure | Current location | How to build on it |
| --- | --- | --- |
| Symbol-based analysis of shared helpers, config reads, OAuth fields, and executable references | `packages/sandbox-compiler/src/compiler-execution.ts` | Add capability inference to the same traversal. |
| TypeScript checker lifetime and per-entry execution analysis | `packages/sandbox-compiler/src/compiler-project.ts`, `packages/typescript-compiler/src/index.ts` | Keep analysis inside the existing live project scope and reuse per-entry results. |
| Required/optional config and executable-dependency metadata | `packages/contract/src/modules/plugins/execution-metadata.ts` | Add capabilities to the canonical generated representation without creating a competing grant list. |
| Metadata merged into single-source and package compiler results | `compiler-core.ts`, `compiler-builtins.ts`, `compiler-plugin-manifest.ts` | Validate inferred capabilities in both paths before returning compiled output. |
| Registered executable graph and source-plan selection | `packages/contract/src/modules/plugins/execution.ts` | Preserve local grant separation and use the graph where transitive effect validation needs it. |
| Runtime host selection, filesystem permission selection, and dedicated worker selection | `kernel/backend/src/lib/infrastructure/sandbox-runtime/service.ts` | Continue using validated persisted capabilities as the authority. |
| Durable host construction and authored-manifest comparison | `runner-source.sandbox.ts` | Replace dependence on source-authored capabilities with pinned compiled metadata. |
| Subject/plugin/provider/bootstrap restrictions | `capability-policy.ts`, `shared.ts` | Preserve checks independently of how capabilities are generated. |
| Inline durable host-call classification | `kernel/backend/src/modules/sandbox/durable-host-dispatcher.ts` | Continue classifying generated local capabilities using the existing dispatch table. |
| Policy and automation retry validation | `packages/contract/src/modules/plugins/manifest.ts` | Apply those rules to generated facts. |

A scan found 251 production plugin files containing capability declarations, including shared manifests, and 29 using capability-parameterized host types. These are migration estimates, not counts of executable entrypoints; refresh the inventory against the completed ingestion work.

Confirm these prerequisites before editing:

1. Generated config/dependency metadata is canonical through compiler, archive, installation, registry, and runner boundaries.
2. The analyzer follows used helpers and distinguishes unsupported dynamic dependencies from absent dependencies.
3. The final SDK config and executable-reference APIs are established.
4. The ingestion changes and their focused E2E suites pass.
5. There is no active concurrent migration of these same compiler/SDK/runtime interfaces.

## Analysis design

### Local capabilities and executable dependencies

Keep these outputs separate:

- Local capabilities describe operations performed by an executable and its ordinary helper code.
- Executable dependencies describe operations delegated to separately executed scripts or workflows.

For example, an import workflow that invokes a collector does not acquire the collector's `httpCall`, `artifact-read`, or `scratch` grants. The collector gets its own generated set. The workflow retains its separate replay/child-call protocol and current restriction against direct host capabilities.

`executeWorkflow`, replay activities, and replay child calls remain executable-dependency operations. Do not add a new ordinary host capability merely to represent those calls.

Within one executable, use a conservative union across supported branches. Capabilities describe possible access, not the subset used by one settings selection. The existing source plan separately evaluates settings-dependent readiness.

### Recognition rules

- Resolve canonical SDK symbols and aliases; do not match arbitrary function names or require the host parameter to be named `host`.
- Derive ordinary host-method recognition from the existing SDK host contracts/capability vocabulary.
- Follow relevant plugin helper functions, closures, and callbacks through the existing symbol traversal.
- Count a resolved host method used as a value, not only a direct call. Existing `executeRyotqlRecipe(host.executeRyotql, recipe)` and `resolveEpisodes(..., host.executeRyotql)` patterns must work.
- Ignore type-only references, including `typeof host.method` inside a type expression.
- Do not infer grants from unused helper bodies merely because their module is imported.
- Cover executable definition input/output callbacks and relevant module initialization. Do not silently omit executable initialization effects; reject unsupported initialization patterns where complete analysis cannot be established.
- Reject unbounded dynamic indexing, reflection, or host escapes that prevent identifying possible operations. A finite selection is acceptable only when every possible SDK method can be resolved.
- Produce sorted, unique capability sets and source-located diagnostics for unsupported forms.

For ordinary capabilities, a resolved method reference provides enough information to record the grant. For dependency-bearing methods such as `getPluginConfig` and `executeWorkflow`, retain the stricter direct/finite argument rules established by ingestion. Do not relax config-key or executable-target authorization as a side effect of supporting method references.

### SDK intrinsic boundaries

The current analyzer traverses plugin source files, not SDK implementation bodies. Add a small SDK-owned intrinsic mapping for the stable public operations that hide host or filesystem usage:

| SDK operation | Required local capability |
| --- | --- |
| `readArtifact` exported Effect | `artifact-read` |
| `readNamedArtifact` | `artifact-read` |
| `writeScratchChunks` | `scratch` |
| `createYoutubeMusicClient` | `httpCall` |
| `createYoutubeHistoryClient` | `httpCall` |

Resolve these entries by canonical SDK symbol/export identity, including imports renamed by a plugin. Do not scan third-party library internals or infer capabilities from unrelated helpers with the same name.

This mapping is part of SDK/compiler semantics, like the existing mapping from filesystem grants to Deno permissions. It is not a plugin-authored readiness or capability list. Test it against actual SDK behavior so a wrapper change cannot silently leave the compiler summary stale.

Ordinary recipe/parser/data transformation utilities do not grant capabilities simply because they are imported. For example, a RyotQL recipe builder is pure; forwarding `host.executeRyotql` into its execution helper is what identifies the host operation.

### Restrictions after inference

Validate the complete generated result after combining author-owned fields and inferred metadata:

- Workflows still have an empty local capability set and use their replay interface.
- Policy automations use only the existing policy-safe capability set and cannot use nested workflow execution.
- Package-level hook, bootstrap, provider, and private-plugin validation continues applying its existing rules.
- Runtime still checks subject, plugin scope, provider association, bootstrap association, resource grants, ownership, OAuth scope, and budgets.

Apply generated restrictions in both `compileSandboxSource` and package/built-in compilation. Do not rely solely on later CLI `PluginScript` decoding to catch prohibited inferred capabilities.

### External effects and retry validation

Capabilities currently also participate in HTTP/notification retry checks. Preserve the existing external-idempotency requirements for retryable hooks.

Use generated local facts for ordinary shared helpers. Where a hook delegates to another registered executable, follow the executable graph to detect reachable HTTP/notification effects without adding child capabilities to the parent's runtime grants.

Use bounded graph traversal with cycle protection. Treat possible registered alternatives conservatively for package-level validation. Keep handling of kernel-owned workflows explicit and aligned with their existing execution guarantees; do not assume an unresolved target is harmless or broaden the follow-up into a general effect engine.

## Authoring, compiled metadata, and host types

### Manifest separation

Separate the authored sandbox manifest schema from the compiled executable metadata schema.

- Remove `capabilities` from source-authoring schemas and `defineManifest` input.
- Keep `capabilities` in compiled/persisted script metadata, preferably in its existing flat location.
- Reject authored capability fields rather than accepting and ignoring an obsolete override.
- Keep identity, kind, automation type, input projection, and provider search-option fields author-owned.
- Validate generated policy/workflow capability restrictions in the compiled representation.
- Preserve compile-manifest comparison, archive coverage/source/hash checks, and registry validation against the correct representation.

The generated capability array must have one canonical owner. Do not store separate authored, analyzed, and effective arrays that require synchronization.

### Host types

Replace callback typing based on `Manifest["capabilities"]` with kind-based SDK host surfaces:

- Ordinary script/provider/operation/after-automation callbacks receive their kind's supported host surface.
- Policy callbacks receive the restricted policy-safe surface without `executeWorkflow`.
- Workflows keep the existing replay interface rather than receiving a general host.
- Shared helpers may accept narrow method subsets such as `Pick<ScriptHost, "httpCall">`; those types describe an interface, not an authoritative grant list.

Use schema-derived and existing mapped types; do not mirror host method signatures. The compiler determines each executable's actual grant set, and runtime policy enforces it.

Update `defineSandboxTestHost`, `runSandboxTestScript` typing where required, and SDK compile-time tests. Unit tests should supply the methods their subject needs without implementing every possible host method or restoring capability arrays solely for testing. Keep generated-metadata enforcement in compiler/runtime tests; do not add an implicit compiler build to every adapter unit test.

## Runtime behavior

Make validated, pinned compiled metadata the authority for capability grants.

In particular:

1. Durable host construction must stop reading `definition.manifest.capabilities` and use the execution payload's validated metadata.
2. Runner manifest matching must compare author-owned fields without requiring generated capabilities to exist in the source manifest.
3. Normal host selection, diagnostic selection, inline durable settlement, filesystem permission selection, scratch allocation, and dedicated worker selection must all continue using the same generated set.
4. The bridge and durable dispatcher must continue denying operations outside that set and outside the execution's subject/resource authority.
5. Replay must use retained metadata and revision pins rather than analyzing or loading current plugin code.

Do not remove metadata integrity checks wholesale. Distinguish authored-field matching from compiled-metadata validation. The runtime does not recompute TypeScript analysis; it consumes the validated compiled artifact/persistence pipeline established by ingestion.

Keep `artifact-read` and `scratch` as filesystem grants, not bridge-callable host methods. Inference establishes that code needs access; only trusted per-execution grants supply actual allowed paths.

## Ordered implementation work

### 1. Refresh the completed baseline and inference fixtures

- Read the final ingestion interfaces and applicable `AGENTS.md`/READMEs.
- Locate every remaining authored capability list, capability-based host type, and runtime consumer.
- Establish focused fixtures for direct calls, shared helpers, method forwarding, SDK intrinsics, unused helpers, and parent/child separation.
- Check current package validation for policy/workflow restrictions and retry effects.

Done when the migration inventory and tested inference boundaries match the completed ingestion implementation.

### 2. Extend the existing execution analyzer

Locations: `compiler-execution.ts`, compiler project orchestration, SDK intrinsic/host contract definitions.

- Add local capability collection to the existing symbol traversal.
- Recognize method calls/references and the SDK intrinsic boundaries above.
- Preserve required/optional config, OAuth fields, executable references, and selection metadata.
- Add diagnostics for unanalyzable host access and unsupported initialization boundaries.
- Emit deterministic capability metadata while the existing TypeScript project/checker is alive.

Done when all recognition fixtures produce the expected grants without overgranting unused code or inheriting child grants.

### 3. Update authoring schemas and host typing

Locations: sandbox SDK `core`, `driver`, `automation`, `operation`, `provider`, `workflow`, `testing`; contract execution metadata and script schemas; compiler protocol and manifest validation.

- Remove source-authored capability fields.
- Introduce the authored/compiled representation distinction and kind-based host types.
- Validate inferred policy/workflow restrictions in every compiler entrypoint.
- Keep generated capabilities canonical in compiled script metadata.
- Migrate helper and test-host typing without generated per-script type files or compatibility exports.

Done when source manifests contain no grant list, generated manifests still contain validated grants, and prohibited direct or indirect operations fail clearly.

### 4. Switch runtime consumers to generated authority

Locations: sandbox runner, runtime service, capability policy, durable dispatch, definition registry, archive/CLI validation, built-in compiler and assembly.

- Update durable host construction and authored-field matching.
- Keep normal/inline host selection and Deno resource permissions coherent.
- Preserve subject/private/system/provider/bootstrap restrictions and executable authorization.
- Keep generated facts pinned through replay and artifact retention.
- Preserve package retry validation and detect child external effects through the existing graph.

Done when both normal and durable executions expose only their generated local grants and all existing authorization restrictions still apply.

### 5. Migrate all sources and fixtures

- Remove capability arrays from media, fitness, and fixture scripts, shared manifests, and workflows.
- Remove the array from kernel-owned notification scripts and other built-in entries.
- Update E2E/private-plugin source generators, compiler/archive fixtures, runtime fixtures, SDK type tests, and test hosts.
- Replace capability-based helper typing with the new kind/method-subset forms.
- Rebuild generated runner and kernel-script artifacts through their owning tooling; never edit generated source manually.
- Update plugin-kit authoring docs and runtime architecture docs to explain generated capabilities and runtime restrictions.

Done when searches find no authored lists or obsolete manifest-dependent host types in supported source/fixture paths.

### 6. Validate and remove replaced paths

- Remove obsolete source capability extraction/comparison and obsolete type tests that assert per-manifest host narrowing.
- Keep tests for actual argument/result contracts and kind restrictions.
- Review generated metadata agreement across single-source, package, CLI/archive, installed private plugins, and built-in compilation.
- Verify production assembly still ships prebuilt artifacts without compiler workers.
- Run relevant package/backend/client checks and focused E2E files, then the repository acceptance gates.
- Execute the required cleanup skill once after implementation, with checks appropriate to any resulting edits.

## Required validation

| Area | Required cases |
| --- | --- |
| Host recognition | Direct calls, renamed host parameter, shared/default-exported helpers, closures, method forwarding, unrelated same-name functions, type-only references. |
| SDK boundaries | Artifact Effect, named artifact reads, scratch writes, renamed imports, YouTube factories using HTTP, pure utilities not adding grants. |
| Precision | Unused helper not granted; possible branch granted; parent does not inherit child grants; sorted unique output; stable results across repeated builds. |
| Unsupported forms | Unbounded method indexing, reflective/unknown host escapes, unsupported initialization, config/executable aliases still rejected where argument analysis requires it. |
| Kind restrictions | Direct and helper-mediated policy violations, policy nested execution rejection, workflow host/filesystem violations, validation in both compiler entrypoints. |
| Metadata pipeline | Authored capability rejection, generated result round-trip, mismatched metadata rejection, registry persistence, pinned compiled facts on replay. |
| Runtime | Normal and durable host construction, diagnostics, inline settlement, undeclared operation denial, subject/plugin/provider/bootstrap checks, OAuth and resource authority. |
| Filesystem | Inferred need without supplied grant does not authorize a path; scratch remains bounded; filesystem operations remain outside bridge dispatch. |
| Retry | Local and delegated HTTP/notification effects retain external-idempotency checks; graph alternatives and cycles do not hide effects or grant parent access. |
| SDK/test hosts | Kind-based callbacks, restricted policy surface, helper method subsets, adapter tests require only their dependencies, app-owned type contract checks. |

Use the existing injected Layer and test-host surfaces. Do not introduce module mocks, spies, fake timers, or library-behavior tests.

Relevant suites include execution/compiler tests, SDK host/workflow/provider/automation types, contract manifest/execution tests, CLI/archive tests, runtime runner/host/bridge/durable-dispatch/checkpoint tests, and shipped plugin helper tests.

Run affected E2E files individually. Include the sandbox async-flow, cache, RyotQL authorization, and YouTube tracer suites; automation retries/lifecycle suites; private-plugin installation/import/integration suites; and ingestion durability where changed fixture contracts affect it. Choose exact existing filenames after refreshing the final baseline. Do not run the full E2E suite or live provider tests without their required opt-in conditions.

Final acceptance gates:

```sh
bun run check
bun turbo --filter='!@ryot-app/e2e' test
```

Run individual E2E files through the existing command:

```sh
bun turbo --filter=@ryot-app/e2e test --only -- '<file>'
```

## Completion criteria

- Source manifests do not declare capabilities, including empty arrays on workflows.
- Every compiled executable has a deterministic, validated generated local capability set.
- Used shared helpers, method forwarding, filesystem operations, and SDK-backed HTTP factories are covered.
- Child executable grants remain separate from parent grants.
- Readiness/config/dependency inference from ingestion continues working without weaker argument checks.
- Normal and durable runtime paths consume pinned compiled metadata rather than source-authored grants.
- Policy, workflow, subject, private/system plugin, provider/bootstrap, resource, and retry restrictions remain effective.
- All shipped scripts, kernel entries, private-plugin fixtures, generated artifacts, authoring docs, and relevant tests use the new model.
- There is no second analysis pipeline, manual grant override, compatibility mode, or new ingestion feature scope.
