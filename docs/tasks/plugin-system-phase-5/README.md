# Plugin System - Phase 5: Minimal User-Level Plugins

## Tasks

**Overall Progress:** 0 of 9 tasks completed

**Current Task:** [Task 01](./01-namespaced-package-identity-cutover.md) (todo)

### Task List

| #   | Task                                                                                 | Status |
| --- | ------------------------------------------------------------------------------------ | ------ |
| 01  | [Namespaced Package Identity Cutover](./01-namespaced-package-identity-cutover.md)   | todo   |
| 02  | [Definition-Only User Installation](./02-definition-only-user-installation.md)       | todo   |
| 03  | [Installation-Scoped Operations](./03-installation-scoped-operations.md)             | todo   |
| 04  | [Installation-Scoped Providers](./04-installation-scoped-providers.md)               | todo   |
| 05  | [Removal and Reinstall](./05-removal-and-reinstall.md)                               | todo   |
| 06  | [First-Party Installation Cutover](./06-first-party-installation-cutover.md)         | todo   |
| 07  | [Active-Installation Media Monitoring](./07-active-installation-media-monitoring.md) | todo   |
| 08  | [Phase Gate and Documentation](./08-phase-gate-and-documentation.md)                 | todo   |
| 09  | [Codebase Cleanup](./09-codebase-cleanup.md)                                         | todo   |

## Problem Statement

Ryot has a complete plugin runtime for trusted, instance-global packages. Plugin manifests own
definitions and sandboxed behavior, compiled scripts are content-addressed, durable workflows pin
exact script versions, and media and fitness are loaded as first-party plugins.

The current public plugin management surface is administrator-only and instance-global. A package is
identified by a global slug, the loader requires global uniqueness for definitions and executable
entries, and per-user plugin state affects presentation without consistently gating catalogs or
runtime dispatch. Ordinary users therefore cannot install a plugin for themselves, and unrelated
user packages cannot safely reuse logical slugs.

Phase 5 needs only the minimum architecture required to support user-owned plugin installations. It
is not intended to deliver a production-ready public plugin ecosystem. The system must establish
package identity, installation ownership, collision-safe physical names, per-user visibility and
execution, first-party auto-installation, removal with preserved data, and two-user isolation.

Arbitrary uploaded source must not inherit trusted first-party authority. Rather than building broad
consent, networking, scheduling, secret-management, and abuse-control platforms now, the initial
uploaded-package feature set will be deliberately narrow and will reject unsupported manifest
sections and capabilities.

This is a greenfield project. Breaking schema and contract changes are allowed, development databases
are disposable, and the existing global administrator install surface can be removed without a
compatibility path.

## Solution

Keep the existing global package ingestion and loader architecture, but give every package a stable
opaque package ID and use it to namespace all package-owned physical identities. Logical slugs remain
the authoring format inside a manifest; ingestion translates them into collision-safe physical
identities before definitions or references enter the registry or database.

Add one user-owned installation record that links a user to a package. A user may have at most one
installation of a package. The installation owns active or removed state, workspace order,
first-party bootstrap completion, and execution attribution. Uploaded source creates a new immutable
package for the installing user; identical uploads are not deduplicated across users in this phase.

Reuse the current synchronous manifest-plus-source-file-map install payload and compiler. Successful
compilation persists the package and active installation atomically. Validation or compilation
failure returns diagnostics directly and persists neither. Reinstall reactivates the same removed
installation and package; changed source is a new package.

Uploaded packages support only definitions, saved views, providers, user-authenticated operations,
package-scoped user queries and writes, caches, logs, and spans. They cannot use user bootstrap,
networking, config or secrets, imports, integrations, automations, signals, workflows, crons, boot
entries, filesystem grants, global data, system configuration, or cross-package references.

Media and fitness use reserved package IDs and receive active installations automatically for every
new user. Users may remove and reinstall those installations while preserving domain and workspace
data. First-party package boot and cron behavior remains package-level, but user-facing behavior and
the media-monitoring audience must require an active installation for the affected user.

Implementation scope is backend services, backend-owned contracts and packages, first-party plugin
packages where required, and backend/e2e tests only. No UI work is part of this phase.

## User Stories

1. As a Ryot user, I want to install a plugin for my account without administrator involvement, so that the package is private to my use.
2. As a Ryot user, I want another user's install and removal choices isolated from mine, so that packages are genuinely user-owned.
3. As a Ryot user, I want install validation and compilation errors returned directly, so that failed source leaves no partial installation.
4. As a Ryot user, I want a successfully installed package to appear in only my catalogs and workspaces, so that other users do not see it.
5. As a Ryot user, I want package operations to execute as me, so that existing user-scoped authorization protects my data.
6. As a Ryot user, I want package queries and writes limited to that package's definitions and data, so that it cannot inspect unrelated account data.
7. As a Ryot user, I want package caches isolated by installation, so that another user installing the same source cannot read my cached values.
8. As a Ryot user, I want to remove a plugin without deleting its domain data, so that I can restore access later.
9. As a Ryot user, I want removed package definitions and data hidden from ordinary reads, so that unavailable workspaces do not remain partially visible.
10. As a Ryot user, I want reinstall to restore the same package and preserved workspace state, so that removal is reversible.
11. As a Ryot user, I want removal refused while nonterminal package work still exists, so that pinned workflows are not broken.
12. As a Ryot user, I want at most one installation of a package, so that operation and workspace identity remain unambiguous.
13. As a plugin author, I want to keep ergonomic logical slugs in source, so that system namespacing does not complicate authoring.
14. As a plugin author, I want unrelated packages to reuse the same logical slugs, so that global naming coordination is unnecessary.
15. As a plugin author, I want changed source treated as a new package, so that this milestone does not imply upgrade semantics.
16. As a plugin author, I want unsupported manifest sections rejected clearly, so that the minimal feature boundary is predictable.
17. As a plugin author, I want package-scoped providers and operations to use existing sandbox execution, so that no second runtime is introduced.
18. As a first-party plugin maintainer, I want existing user bootstrap to remain idempotent, so that media and fitness reinstall safely.
19. As a media user, I want media installed automatically for a new account, so that current first-party behavior remains available by default.
20. As a fitness user, I want fitness installed automatically for a new account, so that current first-party behavior remains available by default.
21. As a media user, I want to remove media without deleting my media data, so that I control whether the workspace is active.
22. As a fitness user, I want to remove fitness without deleting my fitness data, so that I can restore it later.
23. As a first-party user, I want a removal tombstone to survive backend restarts, so that media or fitness is not silently reinstalled.
24. As a media user, I want monitoring to exclude me while media is removed, so that inactive packages produce no refresh effects or notifications for me.
25. As a Ryot operator, I want media monitoring to remain one package-level sweep, so that work does not multiply with user count.
26. As a Ryot operator, I want uploaded packages unable to request networking, system authority, global writes, or scheduled work, so that the minimal implementation remains safe.
27. As a Ryot operator, I want simple install-count and source-size limits, so that ordinary upload flooding is bounded without a new quota platform.
28. As a Ryot operator, I want existing compiler and sandbox limits retained, so that uploaded packages cannot bypass established resource ceilings.
29. As a backend contributor, I want one installation-aware resolver used by catalogs and dispatchers, so that active-state checks do not drift by feature.
30. As a backend contributor, I want package identity normalization isolated and tested, so that no user-package data persists an ambiguous slug.
31. As a backend contributor, I want the old administrator plugin surface deleted, so that there is only one production installation model.
32. As a test maintainer, I want two users to install colliding package sources in one backend, so that isolation is proven end to end.
33. As a test maintainer, I want removal and reinstall covered with preserved data, so that lifecycle behavior is a stable backend contract.
34. As a test maintainer, I want first-party active-installation filtering covered, so that media and fitness exceptions cannot bypass user ownership.

## Implementation Decisions

### Phase Boundary

- This phase adds the minimum backend identity, installation, visibility, execution, removal, and isolation model needed for user-level plugins.
- Reuse the existing manifest contract, package compiler, content-addressed script storage, loader snapshot, runtime resolver, sandbox execution, workflow pinning, registry invalidation, and script garbage collection wherever the new ownership model does not require a change.
- Remove the production administrator-only global plugin list, install, uninstall, and slug-based invoke endpoints and their middleware. Do not retain compatibility routes.
- First-party package ingestion remains internal boot orchestration. Global package mutation needed by e2e remains gated test support only.
- Regenerate the initial database migration. No legacy data conversion, compatibility alias, rollout flag, or dual behavior is required.
- Implementation is limited to backend-owned code, contracts, plugin packages where first-party behavior must change, backend tests, and e2e tests.

### Minimal Module Boundaries

- Package identity normalization owns physical identity construction and translation of local manifest references. Other modules do not construct namespaced IDs independently.
- Installation service and repository own user-package linkage, active or removed state, reinstall, workspace state, and lifecycle transaction boundaries.
- Installation-aware runtime resolution owns the shared active-installation check used by definitions, providers, operations, imports, integrations, automations, notifications, saved views, and script dispatch.
- Existing plugin ingestion remains the single compilation and persistence path. It accepts an installation owner for uploaded packages and trusted provenance for first-party packages.
- Existing feature services retain ownership of their data and writes. They consult installation-aware resolution rather than writing installation state themselves.
- Do not introduce package-artifact, submission, diagnostics-history, secret-vault, network-policy, quota-accounting, or package-unload modules in this phase.

### Package Identity

- Replace global plugin slug identity with an opaque package ID. Manifest metadata slug remains a local authoring and display value.
- Media and fitness use reserved package IDs declared by code-owned boot configuration. Uploaded packages receive generated package IDs.
- An uploaded source request always creates a distinct package. Do not deduplicate source or compiled artifacts across packages or users beyond the existing per-script content-addressing behavior.
- Uploaded packages are immutable after successful installation. Changed source is installed as a new package with a new package ID.
- First-party reingestion keeps its reserved package ID and existing exact-script pinning behavior. Public versioning and artifact revisions are not introduced.
- A package's trust class is derived from code-owned boot provenance. Public input and mutable database fields cannot promote an uploaded package to first-party trust.

### Physical Identity and References

- Namespace every package-owned entity, event, relationship, signal, saved-view, script, provider, operation, bootstrap, and binding identity with stable package ID.
- Apply namespacing to first-party packages in the same breaking cutover. Bare media and fitness slugs must not remain an alternate persistence identity.
- Keep logical slugs in manifests and sandbox source. Ingestion normalizes manifest references and embedded query documents to physical identities before registry loading or persistence.
- Event identity includes package, owning entity schema, and local event slug. Other package definitions include package and local slug.
- Persist physical identities in domain rows, query documents, workflow payloads, and execution attribution. Knowledge of a physical ID is not authorization.
- Public definition responses may expose physical identity, local slug, package metadata, and installation identity needed by dynamic backend clients.
- Uploaded manifests may reference only definitions, scripts, providers, and bindings declared by the same package. Reject all uploaded cross-package references.
- Trusted first-party packages may retain explicitly validated cross-package references required by current kernel, media, fitness, and test-plugin composition.
- Runtime resolution captures one loader snapshot and resolves by package ID plus local entry slug. It never scans packages for the first matching slug.

### Installation Storage

- Replace presentation-only plugin state with a real installation record containing opaque installation ID, user ID, package ID, state, workspace order, bootstrap completion, and timestamps.
- Installation state is exactly `active` or `removed`. Do not add separate compiling, ready, failed, disabled, bootstrapping, or removing states.
- Enforce one installation per user and package, including a removed tombstone. Reinstall reactivates the same installation ID.
- Successful uploaded-package compilation persists package, scripts, providers, and active installation in one serialized commit. Any validation, compilation, or persistence failure leaves none of them active.
- User-owned entities, events, relationships, signals, saved-view state, integrations, imports, subscriptions, executions, and workflows that belong to a package retain installation attribution where needed to enforce visibility and dispatch.
- Cache identity includes installation ID plus the existing provider or script partition. Two installations cannot share ephemeral or persistent cache values.
- Workflow references record package and installation identity in addition to exact script identity and content hash.
- Removal keeps the installation tombstone and package rows because preserved domain data and saved-view state continue to reference them.
- Script and module garbage collection continues to use active package and exact workflow-pin liveness. Package or source garbage collection is out of scope.

### Synchronous Ingestion

- Reuse the current JSON request containing a decoded manifest and relative-path-to-source-text file map. Do not add ZIP extraction, multipart handling, upload intents, retained submissions, or source-download APIs.
- Install runs synchronously through validation, compilation, persistence, registry rebuild, and installation creation.
- Return structured validation or compiler diagnostics in the failed HTTP response. Do not persist failed source or diagnostics for retry.
- Validate relative normalized source paths, total UTF-8 source bytes, file count, per-file bytes, manifest cardinality, and existing compiler limits before persistence.
- Source compilation occurs once during installation and never during execution. Existing content hashes remain exact script and workflow-pin identity.
- Reinstall of a removed installation reuses persisted package and scripts without compilation.

### Uploaded Manifest Subset

- Uploaded packages may declare entity schemas with nested event schemas, relationship schemas, saved views, providers, provider scripts, user-authenticated operations, and operation scripts.
- Uploaded operation declarations must use user authentication. Integration-auth operations are rejected.
- Permit schema-provider links within the same uploaded package. Require all entity, relationship, event, and signal automation binding arrays to be empty.
- Require signal schemas, user bootstrap, workflows, imports, integration providers, crons, boot entries, HTTP rate declarations, and all other unsupported manifest sections to be empty.
- Require the plugin config schema to contain no fields. Require every script's plugin-config and system-config key declarations to be empty.
- Reject workflow, automation, and generic script kinds for uploaded packages. Only provider and operation script kinds remain available.
- Permit only `log`, `span`, `getCachedValue`, `setCachedValue`, `claimPersistentValue`, `ensureUserEntities`, `changeUserRelationships`, `createEvents`, `executeQueryEngine`, `getEntitySchemas`, `listEventSchemas`, and `getUserPreferences` capabilities.
- Reject `httpCall`, plugin or system config, integration access, integration listing, global entity or relationship writes, signal emission, notification sending, artifact-read, scratch, and every future capability not added explicitly to the uploaded safe subset.
- Restrict query and definition-listing capabilities to physical definitions owned by the executing package and rows owned by the executing installation.
- Restrict entity, event, and relationship writes to physical definitions owned by the executing package and bind the executing user and installation in trusted backend state.
- Uploaded providers create installation-owned user data. They cannot create global entities or relationships.
- Uploaded packages cannot declare related-user behavior or any cross-user authority.

### Installation Lifecycle

- A successful uploaded install creates an active installation in the same commit that persists the package.
- Removal is synchronous and changes `active` to `removed` under the same lifecycle fence used by entrypoint dispatch.
- Removal refuses while nonterminal workflows, imports, or other exact execution references for that installation remain. It does not add cancellation or draining machinery.
- Removal disables installation-owned integrations and rejects all future user-scoped dispatch, but it does not delete credentials, caches, domain rows, saved-view state, run history, package source, or scripts.
- Removed definitions, saved views, providers, operations, and data are hidden from ordinary catalogs and reads for that user.
- Uploaded reinstall is synchronous and changes `removed` to `active` without compilation or bootstrap.
- First-party reinstall keeps the installation removed while trusted idempotent user bootstrap runs, then changes it to active and restores visibility.
- A removed first-party installation remains removed across backend restart and first-party package reingestion. Reconciliation must not silently recreate it.
- Lifecycle operations are idempotent. Installing a package already owned by the user returns conflict with the existing installation ID; removing an already removed installation and reinstalling an active installation return the existing state.
- There is no separate disable operation in this phase.

### Registry, Visibility, and Dispatch

- Keep one global namespaced package snapshot rather than a snapshot per user.
- Retain packages in the package snapshot after their last installation is removed. Do not add package unloading or dormant-definition loading.
- Every user-facing definition, saved-view, provider, operation, import, integration, automation, signal, and notification lookup proves an active installation for the affected user before returning or dispatching package-owned behavior.
- Uploaded-package catalogs contain only the narrow manifest subset, but the active-installation gate applies to all existing first-party catalogs and behaviors.
- Direct reads by known domain or workflow IDs enforce installation visibility. Physical identity or retained row ownership does not bypass the active check.
- Query validation and execution permit only definitions visible through active installations. Uploaded sandbox queries receive the stricter executing-package scope in addition to user visibility.
- Public operation invocation identifies installation ID plus local operation slug. Runtime resolution uses the installation's package ID and one captured loader snapshot.
- Provider lookup and import identify provider ID already bound to package identity, then prove the executing user's active installation before search, details, resolution, translation, or population.
- Automation and signal dispatch include a manifest binding only when the affected row user has an active installation of the binding's package.
- Notification subscription resolution requires an active installation owning the signal and formatter.
- Saved-view listing and workspace state use installation identity rather than global plugin slug.
- Every queued first-party user workflow carries installation identity and rechecks active state before package code starts or resumes. Existing exact script pinning remains unchanged.
- Registry invalidation and reconciliation publish package changes as today. Installation activation and removal use durable database state; no per-installation registry rebuild is required.

### First-Party Media and Fitness

- Media and fitness use reserved package IDs, namespaced physical identities, and normal user installation rows.
- New-user bootstrap creates active media and fitness installations before package user bootstrap, saved views, and default notification state are reconciled.
- Backend reconciliation creates a missing first-party installation only when no active or removed installation row exists for that user and package.
- First-party package reingestion updates definitions and active scripts under the stable reserved package ID using existing additive validation and workflow pinning.
- First-party package boot and crons remain trusted package-level work and run once per package schedule, not once per user installation.
- Package-level work that affects users includes only users with an active installation of the owning first-party package.
- Media monitoring remains one system-authority package sweep. Its query joins monitoring relationships to active media installations and excludes removed installations.
- A global provider entity is refreshed once even when multiple active users monitor it. User relationships, automations, signals, and notifications remain installation-filtered.
- Removing media or fitness hides its workspace and data, disables its integrations, stops new user work, and preserves domain state. Reinstall restores visibility after idempotent user bootstrap.

### Simple Limits

- Limit each user to 10 uploaded package records total, including removed installations. This bounds retained package growth without package garbage collection.
- Permit only one in-flight install request per user.
- Limit the complete source file map to 2 MiB UTF-8, 100 files, 256 KiB per file, and normalized relative paths of at most 240 UTF-8 bytes.
- Limit uploaded manifests to 32 scripts, 32 entity schemas, 128 nested event schemas, 32 relationship schemas, 32 saved views, 16 providers, 32 operations, and 128 schema-provider links.
- Keep the existing compiler concurrency, timeout, process-tree memory, approved dependency, and diagnostic limits.
- Keep the existing sandbox worker, execution timeout, heap, context, result, host-call, cache item, cache TTL, bridge, log, and stderr limits.
- Do not add per-user HTTP, storage-row, cache-total, log-retention, workflow-count, or durable-step accounting. Uploaded packages cannot access the high-risk features that motivated most of those quotas, and existing runtime ceilings remain in force.
- Limit violations fail before package persistence and leave no installation or active registry entry.

### Public Contracts

- Delete the production `GET /plugins`, `POST /plugins`, `DELETE /plugins/:pluginSlug`, and slug-based operation invoke endpoints.
- `POST /plugin-installations` accepts the existing manifest and source file map shape, compiles synchronously, and returns the active owned installation with HTTP 201.
- `GET /plugin-installations` lists the current user's active and removed installations, including first-party packages and package metadata.
- `GET /plugin-installations/:installationId` returns an owned installation or not found without exposing another user's installation.
- `DELETE /plugin-installations/:installationId` removes an active owned installation synchronously or returns conflict while nonterminal work references it.
- `POST /plugin-installations/:installationId/reinstall` reactivates an owned removed installation synchronously; first-party reinstall returns only after trusted user bootstrap succeeds.
- `POST /plugin-installations/:installationId/operations/:operationSlug` invokes an uploaded or first-party user-auth operation through the existing operation service with installation-bound user authority.
- Integration-auth first-party operations continue to resolve the owning user and installation from the persisted integration rather than accepting installation identity from the caller.
- Existing definition, saved-view, import, integration, automation, notification, entity, event, relationship, and provider contracts retain their product purpose but use physical definition and installation identity where global plugin slug is no longer sufficient.
- Contract errors distinguish invalid source, validation or compilation failure, unsupported uploaded manifest feature, install limit, duplicate installation, inactive installation, nonterminal-work conflict, and unknown installation.
- No config, secret, source-download, diagnostics-history, retry, disable, marketplace, discovery, or package-sharing endpoints are added.

## Testing Decisions

### Test Philosophy

- Test application-owned identity, ownership, visibility, dispatch, lifecycle, and policy behavior rather than schema-library or TypeScript behavior.
- Keep assertions at service, contract, persisted-state, runtime-resolution, sandbox-host, and e2e boundaries.
- Preserve existing plugin ingestion, sandbox, provider, workflow pinning, imports, integrations, automations, notifications, media monitoring, and first-party behavior assertions while changing identity plumbing.
- Use real package ingestion and sandbox execution for e2e coverage. Do not add an in-memory registry mutation seam.

### Backend Coverage

- Identity-normalization tests cover every allowed manifest section, nested event identities, saved-view query documents, schema-provider links, first-party trusted references, collision-free physical IDs, and uploaded cross-package rejection.
- Uploaded-policy tests prove every allowed script kind, manifest section, and capability is accepted and every deferred feature is rejected.
- Installation service tests cover successful atomic uploaded install, validation and compiler rollback, one-installation uniqueness, active and removed transitions, idempotent removal and reinstall, first-party bootstrap failure, install limits, ownership checks, and restart persistence.
- Installation-aware resolver tests prove active-only definitions, saved views, providers, operations, bindings, signals, notifications, imports, integrations, direct-ID reads, and one-snapshot resolution.
- Host-function tests prove uploaded queries and writes remain package- and installation-scoped even when another package belongs to the same user.
- Cache tests prove two installations cannot read each other's ephemeral or persistent values.
- Transactional tests cover install collisions, dispatch versus removal, workflow pin versus removal, and first-party reconciliation versus a removal tombstone.
- Migration checks prove no package-owned data relies on a globally unique manifest slug.

### End-to-End Coverage

- Two users upload the same source and receive distinct packages and installations with independent definitions, data, cache, operations, removal, and reinstall.
- One user installs two structurally different packages that reuse the same logical definition, provider, script, operation, and saved-view slugs; both behave correctly through physical namespacing.
- A user cannot list, inspect, invoke, remove, reinstall, or read retained data from another user's installation.
- Uploaded operations cannot query or mutate another package's data owned by the same user.
- Unsupported networking, config, workflow, import, integration, automation, signal, cron, boot, filesystem, global-write, and system-config declarations fail installation with no persisted package or installation.
- Source-size, file-count, per-file, manifest-cardinality, and per-user package limits fail without partial state.
- Removal hides definitions, saved views, providers, operations, and preserved domain data; uploaded reinstall restores visibility, and first-party reinstall does not duplicate bootstrap data.
- Removal returns conflict while nonterminal work references the installation and succeeds after those references clear.
- Media and fitness are active for a new user, may be removed independently, remain removed after restart and package reingestion, and reinstall idempotently.
- One media-monitoring sweep includes active media installations, excludes removed installations, avoids duplicate global refresh, and emits no excluded-user automation, signal, or notification work.
- The deleted administrator production endpoints are unavailable while gated e2e package support remains functional.

### Verification and Documentation

- Run the backend check and backend test suite after each implementation slice.
- Run focused e2e files while developing and the full standard e2e suite at the phase gate. Existing opt-in operational and live-network gates remain separate unless directly affected.
- Update plugin authoring documentation with user-package manifest restrictions, package-local identity, synchronous install semantics, simple limits, removal behavior, and deferred features.
- Update sandbox documentation with installation authority, package-scoped queries and writes, cache partitioning, and uploaded capability restrictions.
- Update backend and e2e ownership documentation without duplicating the detailed protocol outside its designated reference.

## Out of Scope

- All app-client, frontend, browser-extension, and other UI implementation or testing.
- ZIP archives, multipart upload, upload-intent integration, source download, retained failed source, persisted diagnostics, or asynchronous compilation.
- Package-artifact or revision tables, source deduplication, package sharing, package discovery, marketplace behavior, publisher identity, signing, or attestations.
- Ordinary package versions, upgrades, rollback, replacement, or coexisting revisions.
- More than one installation of the same package for one user.
- Inter-plugin dependencies or uploaded cross-package references.
- Separate disable and enable operations or lifecycle states beyond active and removed.
- Config fields, secret storage, encrypted credential vaults, secret-key rotation, or installation-owned environment fallback for uploaded packages.
- Uploaded-package networking, private-network access, HTTP rate policy, DNS validation, redirect policy, or SSRF infrastructure. Uploaded `httpCall` is rejected instead.
- Uploaded user bootstrap, imports, integrations, automations, signals, notification formatters, workflows, crons, boot entries, system configuration, filesystem grants, global queries, or global writes.
- User-configurable capability approval or any uploaded capability outside the fixed minimal subset.
- Workflow cancellation, draining, or queued-work cleanup during removal. Removal returns conflict while nonterminal references exist.
- Per-user runtime, HTTP, row-storage, cache-total, log-retention, or durable-work quota accounting beyond simple install/source limits and existing compiler/runtime ceilings.
- Package unloading, package/source garbage collection, destructive plugin-data deletion, or raw recovery APIs for removed packages.
- A second standalone user-script authoring mechanism.
- Compatibility for the removed production administrator plugin endpoints.

## Further Notes

- This PRD intentionally establishes an architectural foundation rather than a generally useful third-party plugin platform.
- The narrow manifest subset is the security strategy for this milestone. Unsupported authority is rejected rather than implemented behind incomplete consent or policy controls.
- Keeping all retained packages in one namespaced global snapshot is acceptable for the approved lifetime limit of 10 uploaded packages per user and the feature's expected non-use. Package unloading can be designed only if real usage justifies it.
- Separate packages for identical uploads are an accepted compilation and storage cost. Cross-user artifact deduplication can be introduced later without changing installation ownership.
- Existing first-party package reingestion is not public versioning. It remains a trusted development mechanism under stable reserved package IDs and exact workflow pins.
- Removal preserves data by retaining package and installation rows. Destructive deletion requires a separate explicit design.
- Task decomposition must end with the mandatory codebase-cleanup task. That task follows the codebase-cleanup skill over touched files and directly affected modules, removes verified temporary or redundant residue, and reruns applicable gates.
