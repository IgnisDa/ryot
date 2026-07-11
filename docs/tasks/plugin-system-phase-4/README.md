# Plugin System - Phase 4: Hardening, Purity, and Cleanup

## Tasks

**Overall Progress:** 15 of 18 tasks completed

**Current Task:** [Task 16](./16-ownership-based-e2e-test-tree.md) (todo)

### Task List

| #   | Task                                                                                          | Status |
| --- | --------------------------------------------------------------------------------------------- | ------ |
| 01  | [Mechanical Kernel Purity Gate](./01-mechanical-kernel-purity-gate.md)                        | done   |
| 02  | [Trusted Plugin User Bootstrap](./02-trusted-plugin-user-bootstrap.md)                        | done   |
| 03  | [Media Membership for Imports and Events](./03-media-membership-imports-events.md)            | done   |
| 04  | [Media Membership for Collections and User State](./04-media-membership-collections-state.md) | done   |
| 05  | [Open Plugin Import Envelope](./05-open-plugin-import-envelope.md)                            | done   |
| 06  | [Plugin-Owned Query Recipes](./06-plugin-owned-query-recipes.md)                              | done   |
| 07  | [Domain-Neutral Operational Gate](./07-domain-neutral-operational-gate.md)                    | done   |
| 08  | [Registry Trust and Provenance Simplification](./08-registry-trust-provenance.md)             | done   |
| 09  | [Effect-Only Authoring Boundary](./09-effect-only-authoring-boundary.md)                      | done   |
| 10  | [Content-Addressed Disk Modules](./10-content-addressed-disk-modules.md)                      | done   |
| 11  | [Per-Execution Host-Call Concurrency](./11-per-execution-host-call-concurrency.md)            | done   |
| 12  | [Sandbox and Database Limit Retuning](./12-sandbox-database-limit-retuning.md)                | done   |
| 13  | [Race-Safe Resolution and Uninstall Fencing](./13-race-safe-resolution-uninstall.md)          | done   |
| 14  | [Superseded Script and Module GC](./14-superseded-script-module-gc.md)                        | done   |
| 15  | [Complete Third-Party Plugin Lifecycle E2E](./15-third-party-plugin-lifecycle-e2e.md)         | done   |
| 16  | [Ownership-Based E2E Test Tree](./16-ownership-based-e2e-test-tree.md)                        | todo   |
| 17  | [Final Architecture Documentation and Phase Gate](./17-final-docs-phase-gate.md)              | todo   |
| 18  | [Codebase Cleanup](./18-codebase-cleanup.md)                                                  | todo   |

## Problem Statement

The plugin rewrite has completed its schema registry, plugin ingestion and loading, capability
migrations, and Phase 3 e2e gate. Media and fitness behavior now primarily lives in first-party
plugin packages, and the standard and standalone operational test gates pass. The resulting system
is functional but not yet in its final maintainable state.

The kernel/plugin boundary is not mechanically enforced. Media library concepts still appear in
generic backend workflows, contracts, query recipes, user bootstrap, user-state policy, and
test-support infrastructure. The import HTTP contract still enumerates first-party sources, so a
newly declared plugin source cannot be invoked generically. Domain query recipes remain in a kernel
library. These leaks make future kernel changes depend on first-party plugin vocabulary and let the
architecture drift back toward a monolith.

Several intentionally deferred operational items also remain. Sandbox execution imports compiled
code through in-memory data URLs rather than immutable disk modules. Host-call budgets cap totals but
not concurrency. Worker, workflow-pool, database, and script-kind limits need measurement after the
larger sandbox migration. Superseded immutable script rows have no liveness-aware garbage collector.
Plugin resolution and uninstall need stronger consistency around concurrent snapshot replacement and
running workflow pins.

Finally, the test tree and contributor documentation still describe the pre-final ownership model,
and the third-party-style fixture does not prove the complete required lifecycle through events and
automation. Without Phase 4, the rewrite remains dependent on human discipline rather than enforced
boundaries and repeatable acceptance tests.

## Solution

Phase 4 turns the completed rewrite into an enforced architecture. It first introduces a local purity
gate whose vocabulary is derived from the active media and fitness manifests and whose failures name
the exact source location. Known domain leaks are removed rather than normalized into a permanent
allowlist. The media plugin regains complete ownership of its library entity and relationship,
including user initialization and media-only membership behavior. Generic backend workflows expose or
compose only domain-neutral lifecycle and relationship mechanisms.

Trusted globally loaded plugins gain a small `userBootstrap` lifecycle for idempotent per-user
initialization. It runs sandbox code with user authority and a batch-first host capability restricted
to entity schemas owned by the executing plugin. In Phase 4 this lifecycle is available only to the
trusted boot-configured packages; general user-level installation belongs to Phase 5.

The import request becomes an open, catalog-validated envelope, and domain query recipes move to the
packages that own them. Registry provenance is simplified around the existing meaning that all
registry-supplied definitions are trusted and immutable, while plugin ownership remains explicit.

Sandbox performance is hardened by materializing compiled modules on disk by content hash, bounding
in-flight bridge calls per execution, retuning resource limits from measurements, and garbage
collecting script rows only after active snapshots and running workflows release them. Runtime
resolution observes one complete loader snapshot per operation, and uninstall is fenced so a running
or suspended plugin workflow always causes a conflict rather than racing deactivation.

The final test suite proves the complete plugin lifecycle and is organized by ownership. Documentation
becomes the single source of truth for plugin authoring, sandbox execution, kernel boundaries, test
placement, and the deliberately deferred Phase 5 user-installation model. A final cleanup pass removes
temporary scaffolding and directly affected migration residue without broad unrelated refactoring.

## User Stories

1. As a backend contributor, I want domain vocabulary in kernel source to fail a local gate, so that plugin ownership cannot silently regress.
2. As a backend contributor, I want purity failures to name the file and line, so that violations are quick to correct.
3. As a plugin maintainer, I want the gate vocabulary derived from manifests, so that new schema, provider, script, and source slugs are covered automatically.
4. As a maintainer, I want every purity exception documented narrowly with a reason, so that an allowlist cannot become an unreviewed escape hatch.
5. As a media-plugin maintainer, I want the media package to own library creation and membership behavior, so that generic kernel modules do not encode media policy.
6. As a media user, I want a library entity initialized idempotently for my account, so that media operations always have a membership target.
7. As a media user, I want media imports, events, and collection actions to preserve their current library outcomes, so that the rewrite does not change product behavior.
8. As a fitness user, I want fitness entities excluded from media-library enrollment, so that unrelated domains remain independent.
9. As a third-party plugin author, I want my unrelated global entities excluded from the media library, so that media policy is not imposed on my package.
10. As a user, I want library initialization failures to propagate through the owning operation, so that successful responses never hide incomplete required state.
11. As a plugin author, I want trusted user-bootstrap scripts to mutate only schemas owned by my plugin, so that initialization cannot cross package boundaries.
12. As a plugin author, I want bootstrap writes to be batch-first and idempotent, so that retries are safe and bounded.
13. As an API client, I want a manifest-declared import source to be invocable without recompiling the central contract, so that the import registry is genuinely extensible.
14. As an API client, I want unknown or inactive import sources rejected by the active catalog, so that an open envelope does not weaken validation.
15. As a first-party client maintainer, I want source-specific helpers to retain useful typing outside the generic wire envelope, so that client ergonomics do not require kernel hardcoding.
16. As a media-plugin maintainer, I want media query recipes exported by the media package, so that media schema and relationship literals stay with their owner.
17. As a fitness-plugin maintainer, I want fitness query recipes exported by the fitness package, so that the generic query-engine library stays domain-neutral.
18. As a kernel maintainer, I want generic saved-view query construction to accept domain-neutral predicates, so that it does not know about media libraries.
19. As a test maintainer, I want operational measurement plumbing to be domain-neutral, so that production test-support code does not hardcode media workflow names.
20. As a sandbox user, I want compiled modules loaded from immutable local files, so that execution avoids repeated data-URL import overhead.
21. As a sandbox maintainer, I want compiled files keyed and verified by content hash, so that module identity matches persisted script identity.
22. As a sandbox maintainer, I want concurrent materialization to publish atomically, so that parallel executions never observe partial files.
23. As an operator, I want before-and-after provider-heavy measurements, so that disk materialization is justified by evidence.
24. As an operator, I want each execution to have a bounded number of in-flight host calls, so that one script cannot monopolize bridge and database resources.
25. As a plugin author, I want host calls above the concurrency limit to wait predictably rather than fail arbitrarily, so that bounded batching remains usable.
26. As an operator, I want permits released on success, failure, timeout, and cancellation, so that one failed execution cannot leak bridge capacity.
27. As an operator, I want sandbox worker, workflow-pool, database, and script budgets based on observed load, so that defaults match the final architecture.
28. As a test maintainer, I want the standard suite and the full-size operational gate to pass independently, so that correctness and expensive load measurement remain reliable gates.
29. As a maintainer, I want e2e wall-clock and pressure measurements recorded, so that later tuning has a trustworthy baseline.
30. As a database operator, I want superseded script rows removed when truly unreferenced, so that immutable history does not grow forever.
31. As a workflow owner, I want pinned scripts retained until every running or suspended execution releases them, so that GC cannot break replay.
32. As a kernel maintainer, I want source-zero scripts retained exactly while declared by the running kernel, so that their liveness does not depend on the plugin snapshot.
33. As an operator, I want script GC to be idempotent and safe under concurrent registry changes, so that cleanup cannot race activation.
34. As a plugin user, I want uninstall refused while plugin workflows are nonterminal, so that suspended work remains resumable.
35. As a plugin user, I want uninstall to prevent new dispatch while checking references, so that a new workflow cannot start between validation and deactivation.
36. As a plugin user, I want uninstall to proceed after all references clear, so that retained pins do not block removal permanently.
37. As a runtime maintainer, I want one logical resolution to observe one loader snapshot, so that providers, manifests, and scripts cannot come from different active states.
38. As a plugin author, I want hot reingestion to expose either the complete old package or complete new package, so that transient mixed resolution cannot fail executions.
39. As a plugin author, I want a fake package to prove search, import, events, and automation without restart, so that extensibility is tested end to end.
40. As a plugin author, I want uninstall refusal and eventual success covered in that lifecycle, so that data-reference policy is proven through the public surface.
41. As a test maintainer, I want e2e suites grouped under kernel, media plugin, and fitness plugin ownership, so that test placement reflects architecture.
42. As a test maintainer, I want mixed suites split without weakening assertions, so that organization changes do not disguise behavioral changes.
43. As a contributor, I want plugin-kit documentation to explain every script kind and manifest lifecycle, so that authoring does not require reading implementation code.
44. As a contributor, I want execution authority, capabilities, caches, determinism, and batch guidance documented, so that plugin scripts use safe supported patterns.
45. As a contributor, I want sandbox host functions, grants, workflow primitives, module loading, and limits documented together, so that runtime behavior has one owner.
46. As a contributor, I want module ownership documents updated after moves and deletions, so that stale architecture is not taught to future changes.
47. As a contributor, I want the Phase 5 user-level model explicitly deferred, so that Phase 4 does not accumulate speculative installation infrastructure.
48. As the project owner, I want the backup client retained with explicit deletion TODOs in affected files, so that its temporary status remains visible without deleting it now.
49. As a maintainer, I want retained backup-only contract types narrowly exempted from purity enforcement, so that the exception is visible and removable later.
50. As a maintainer, I want registry ownership represented consistently, so that unused provenance scaffolding does not imply behavior the system does not have.
51. As a plugin author, I want public sandbox and host contracts to remain Effect-only, so that error and interruption semantics are uniform.
52. As a runtime maintainer, I want private Promise interop allowed behind Effect APIs, so that platform and third-party boundaries do not force artificial compatibility layers.
53. As a maintainer, I want a final cleanup pass over touched modules, so that temporary allowlist entries, wrappers, aliases, comments, and dead migration residue do not survive Phase 4.

## Implementation Decisions

### Phase boundary

- Phase 4 operates on trusted, globally loaded packages. Per-user installation, arbitrary user source upload, user namespaces, capability-consent UX, marketplace behavior, signing, inter-plugin dependencies, and plugin versioning are Phase 5 concerns.
- No compatibility API, migration layer, feature flag, or dual behavior is required. The project is greenfield, development databases are disposable, and the initial database migration may be regenerated.
- The backend package-script cleanup was completed separately by the owner and is not part of this PRD.

### Purity enforcement

- Add a deterministic local purity check to the backend check/test flow before other Phase 4 migrations proceed.
- Build banned vocabulary from media and fitness manifests: plugin metadata, entity/relationship/event/signal/saved-view slugs, providers and provider sources, scripts, bindings, operations, workflows, crons, boot entries, import sources, and integration providers.
- Supplement manifest values with explicit conceptual terms that expose policy hidden behind generic names, including media library terminology and removed native module names.
- Scan authored production source in the backend, contract, and query-engine core. Exclude test files and generated sandbox output by rule rather than allowlist entries.
- Keep the V1 legacy-bootstrap quarantine and first-party boot package wiring as narrow justified exceptions. The retained backup client's required contract media types are a temporary documented exception.
- Every reported violation includes the matching term, file, line, and source text. Every allowlist entry includes a reason and the narrowest practical path/term match.
- Temporary entries used to keep the branch shippable while known leaks move must identify their removal task. Final acceptance permits only enduring justified exceptions.
- Task 17 refactors the runtime-cycle analysis out of the module-DAG renderer and runs it through `purity:check`; the HTML renderer remains an optional consumer of the same analysis.
- The current 13-cycle runtime baseline is not allowlisted. Tasks 02-16 may remove cycles incrementally, and Task 17 must reach and enforce zero runtime cycles.

### Media library ownership

- `library` and `in-library` remain media-owned definitions. Kernel source zero remains limited to generic collections, membership, and integration-disabled definitions.
- Remove the native library-membership feature boundary. Generic `EntityImportWorkflow` remains kernel-owned and populates provider entities only; it does not add `in-library`.
- Preserve final relationship state, ownership-source merging, failure propagation, and awaited ordering where media-owned workflows or policy guarantee membership. The direct generic `/entity-import` population-only behavior is an owner-approved change. Shared transaction boundaries between generic and media writes are not an invariant.
- Only schemas owned by the media package receive automatic `in-library` membership. Fitness and unrelated package schemas do not.
- Manifest import-source workflows may emit generic user-relationship mutation intents. Media adapters use that domain-neutral shape for `in-library` mutations and ownership properties; direct generic `/entity-import` does not.
- Move the library-specific prohibition on clearing or merging user state into declarative entity-schema policy consumed generically by the user-state service. Do not retain a `library` string branch in the kernel.
- Events and collections own media-membership policy through awaited media lifecycle/relationship automation. Generic workflows await that plugin work where their successful result guarantees membership completion.

### Trusted plugin user bootstrap

- Add `userBootstrap` as a distinct manifest section rather than overloading server `boot`.
- Phase 4 permits it only for boot-configured trusted packages. General installed-package lifecycle is deferred to Phase 5.
- Each entry has a stable slug, description, and direct target script. Validation requires the target to be a compatible script declared by the same package.
- Dispatch occurs during new-user bootstrap with user authority and deterministic execution identity. The hook is idempotent because retries may replay after failure.
- Add a batch-first user-entity ensure/upsert host capability available only to trusted user-bootstrap executions. The kernel binds the executing user and package identity and rejects schemas not owned by that package.
- The media bootstrap script ensures exactly one user-scoped library entity with the existing name and empty initial properties. Existing development data requires no migration or backfill.
- A hook failure prevents overall user bootstrap completion and is retried through the existing bootstrap path.

### Import contract

- Replace the closed first-party source union with a generic envelope containing a non-empty source slug and source-specific fields/artifact tokens.
- The active import-source catalog is the runtime source of truth. Unknown or inactive sources fail before any artifact is claimed or workflow starts.
- Manifest file-source declarations remain the source of truth for accepted upload-token fields, named artifacts, optionality, and file extensions. Payload sources forward only validated JSON-compatible fields.
- Keep plugin-owned source-specific schemas/helpers for first-party clients where useful; they compose into the generic wire request rather than changing the central contract.
- Do not add an import-source listing/discovery endpoint in Phase 4.

### Query recipe ownership

- Move every media-only query recipe into the media package and every fitness-only query recipe into the fitness package, with explicit package exports.
- Retain generic entity-detail, event-history, interest, and saved-view construction primitives in the query-engine package.
- Remove the media `requireInLibrary` option from the generic saved-view helper. The media package owns a wrapper or predicate composition that adds its library traversal.
- Update consumers and tests directly; do not retain forwarding re-exports from the old locations.

### Registry provenance

- In Phase 4, all definitions present in the trusted registry are system-provided, immutable definitions. `pluginSlug` distinguishes plugin ownership from kernel source zero.
- Remove the non-builtin provenance sets and predicates that are never populated. Preserve contract behavior that first-party registry definitions report as builtin where consumers still require that product distinction.
- Signal authorization must rely on active trusted registry definitions rather than a hardcoded boolean whose provenance is not represented.
- Phase 5 will replace or extend this trust model for ordinary user packages; Phase 4 must not anticipate that model with unused fields.

### Runtime module materialization

- Materialize persisted compiled JavaScript into the existing read-only sandbox runtime area by compiled content hash.
- Write to a temporary file, verify bytes/hash, and publish atomically. Concurrent requests for the same hash converge on one immutable file.
- Pass the local module path to the runner and import it as a file module. Remove compiled source from the execution payload once no consumer needs it.
- Grant read access only to the runtime directory already approved for dependencies/modules. Preserve denial of remote modules, environment, subprocess, and ambient configuration.
- Update source mapping and stack sanitization so local runtime paths never leak in returned errors.
- Couple disk-file cleanup to script-row GC or a content-hash liveness pass so files do not grow without bound.
- Measure a stable provider-heavy e2e path before and after; record execution timing and suite wall-clock rather than asserting a brittle fixed threshold.

### Host-call concurrency

- Add a per-execution semaphore to active bridge-session state. It is independent of existing total and HTTP call-count budgets.
- Select the limit from observed batched activity/import behavior and record the evidence in the Phase 4 plan.
- Calls above the limit wait within the execution deadline. Permit acquisition and release are interruption-safe, and session removal cannot strand waiters.
- Add focused tests for maximum concurrency, queued calls, failure, timeout, cancellation, and isolation between execution ids.

### Pool and budget retuning

- Measure standard e2e wall-clock, standalone operational-gate wall-clock, sandbox overlap, database pool pressure, workflow pool waits, advisory waits, deadlocks, and Redis projection pressure.
- The standard suite and unchanged two-concurrent-1,001-item operational file are separate required gates. Running the expensive file alongside every standard suite is diagnostic only, not a permanent acceptance command.
- Retune sandbox worker concurrency, application/workflow database pools, Postgres connection ceiling, and per-script-kind execution/host-call budgets as one documented arithmetic model.
- Do not weaken workloads, assertions, or timeout semantics to obtain a green measurement.

### Script liveness and GC

- Define liveness from active registry snapshots, nonterminal workflow pins, and the running kernel source-zero declaration set.
- Plugin uninstall fences new entrypoint dispatch, checks entity/provider references and nonterminal workflow pins, and returns conflict when any remain. If refusing, dispatch becomes available again without changing the active snapshot.
- Script GC deletes only immutable rows absent from all liveness sets. Source-zero rows are candidates only when their content hashes are no longer declared by the running kernel.
- GC is idempotent and safe under concurrent ingestion, invalidation rebuild, workflow start/completion, and repeated cleanup.
- Disk modules use the same content-hash liveness decision.

### Snapshot consistency

- Runtime resolver methods capture one loader snapshot at entry and derive provider, operation, manifest, binding, and active script decisions from that snapshot.
- Database rows remain immutable by content hash, allowing either complete old or complete new resolution around a swap.
- Add concurrent reader/swap tests and uninstall/dispatch race tests. Do not change the intentional rule that new entrypoint dispatch resolves to the active script while workflow replay uses exact pinned ids.

### Effect boundary

- Sandbox script definitions, SDK authoring APIs, backend host-function contracts, and typed bridge dispatch return/compose Effect values.
- Remove any public raw-Promise compatibility host surface or obsolete dual API.
- Private adapters may use `tryPromise`, `runPromise`, or async functions where required by Deno, fetch, filesystem bindings, Redis clients, or third-party libraries. These adapters must not leak Promise authoring to plugin definitions.

### Tests and documentation

- Reorganize e2e tests into kernel, media-plugin, and fitness-plugin ownership. Mixed files may be split, but test intent and assertions remain unchanged.
- Extend the fake plugin lifecycle to include one observable event and automation result between import and uninstall.
- Add e2e coverage for media-only library eligibility, trusted media user bootstrap, generic import-source dispatch, workflow-pin uninstall refusal, and successful uninstall after references clear.
- Keep the full-size operational gate opt-in and standalone.
- Update test conventions, plugin authoring reference, sandbox runtime reference, module ownership documents, and the plugin-system plan records under the single-owner documentation rule.
- Retain the backup client. Add the owner-requested deletion TODO to every affected backup/dependent file during the cleanup task and document its purity exception.

### Final cleanup

- The mandatory final task follows the codebase-cleanup criteria over files touched by Phase 4 and directly affected modules only.
- Remove temporary purity exceptions, obsolete library wrappers/contracts/workflow names, dead provenance scaffolding, compatibility aliases, stale generated assumptions, redundant tests, resolved migration TODOs, and unused exports introduced or exposed by the work.
- Do not extract tiny shared helpers, inline useful local abstractions, or perform unrelated style refactors merely to reduce line count.

## Testing Decisions

- Tests prove Ryot-owned behavior and branching, not Effect, Deno, PostgreSQL, or schema-library behavior in isolation.
- Existing e2e assertions are preserved. A behavior change requires explicit owner approval; file moves and fixture plumbing are not permission to weaken assertions.
- The purity gate is tested with representative forbidden hits, allowlisted hits, generated/test exclusions, manifest-derived vocabulary changes, and exact file/line diagnostics.
- Module-DAG tests cover import-edge extraction and deterministic cycle diagnostics; final acceptance runs the non-rendering cycle check through `purity:check` and requires zero runtime cycles.
- Library tests cover new-user bootstrap, retry/idempotency, media-only eligibility, awaited event/collection membership, manifest import-source relationship mutations, ownership-source merging, user-state clear/merge policy, and exclusion of fitness/unrelated schemas. Direct generic `/entity-import` tests assert population without `in-library`.
- Import tests install a fixture declaring a source absent from the central contract, invoke it through the generic envelope, validate payload/artifact rejection, and observe terminal workflow results.
- Runtime tests cover atomic module materialization, cache reuse, concurrent builders, path grants, source mapping, sanitized errors, and file cleanup liveness.
- Bridge tests measure real maximum in-flight calls with controlled deferred handlers and prove permit release and execution isolation.
- Resolver and uninstall tests use controlled concurrent snapshot replacement, workflow pin creation/completion, and dispatch fencing rather than timing sleeps.
- GC tests construct active, superseded, pinned, unpinned, source-zero-declared, and source-zero-obsolete rows and assert only dead rows/files are removed.
- The third-party-style e2e fixture proves install, reingest where still supported, search, import, event, automation, uninstall refusal, cleanup, uninstall, and rejection of execution after uninstall without restart.
- Test-tree reorganization is verified by the unchanged full suite and by searches ensuring no suites remain in obsolete ownership directories.
- Performance tests record measurements but avoid fixed machine-dependent speed assertions. Correctness limits and terminal completion remain asserted.
- Run backend checks through Turbo, backend unit tests from the backend package, affected plugin package tests, the full standard e2e suite, and the standalone operational gate before Phase 4 acceptance.

## Out of Scope

- User-owned plugin installations and per-user plugin registries.
- Arbitrary user source upload, install quotas, capability-consent UX, SSRF policy for untrusted packages, and package distribution.
- Plugin versioning, upgrade coexistence, or data migration between package versions.
- Third-party namespaces as a user-visible product feature.
- Marketplace, signing, attestation, publisher identity, and inter-plugin dependencies.
- Plugin data-deletion policies beyond refusing removal while referenced.
- A standalone per-user script feature outside the plugin model.
- Deleting the backup client.
- Source discovery/listing for import sources.
- Requiring the expensive operational gate to pass while all standard e2e files run concurrently.
- Unrelated backend package-script cleanup, dependency cleanup, or broad repository refactoring.

## Further Notes

- The overview and Phase 4 plan remain the architectural decision record. If implementation evidence
  contradicts a settled decision, stop and update the plan with the owner rather than silently
  changing behavior.
- Phase 3's standard and standalone operational gates are the baseline. Phase 4 measurements compare
  against that baseline; they do not reopen completed migration tasks.
- Phase 5 has its own planning record containing unresolved questions for user-level plugin
  installation. No Phase 4 issue should implement those questions speculatively.
- The project is greenfield. Prefer direct breaking cleanup over compatibility aliases, migrations,
  deprecated endpoints, fallback payloads, or dual code paths.
