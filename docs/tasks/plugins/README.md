# User-Owned Plugins

## Tasks

**Overall Progress:** 0 of 11 tasks completed

**Current Task:** [Task 01](./01-private-plugin-install-and-invoke.md) (todo)

### Task List

| #   | Task                                                                                       | Status |
| --- | ------------------------------------------------------------------------------------------ | ------ |
| 01  | [Private Plugin Install And Invoke](./01-private-plugin-install-and-invoke.md)             | todo   |
| 02  | [System Plugin Provisioning](./02-system-plugin-provisioning.md)                           | todo   |
| 03  | [Installation Configuration And Controls](./03-installation-configuration-and-controls.md) | todo   |
| 04  | [Plugin Update And Uninstall](./04-plugin-update-and-uninstall.md)                         | todo   |
| 05  | [Qualified Definitions And Providers](./05-qualified-definitions-and-providers.md)         | todo   |
| 06  | [Scoped Imports And Integrations](./06-scoped-imports-and-integrations.md)                 | todo   |
| 07  | [Private Automations And Lifecycle](./07-private-automations-and-lifecycle.md)             | todo   |
| 08  | [Registry Reconciliation And System Conflicts](./08-registry-reconciliation-and-system-conflicts.md) | todo   |
| 09  | [Backup Format Replacement](./09-backup-format-replacement.md)                             | todo   |
| 10  | [Rust V1 Legacy Migration](./10-rust-v1-legacy-migration.md)                               | todo   |
| 11  | [Final Codebase Cleanup](./11-final-codebase-cleanup.md)                                   | todo   |

## Problem Statement

Ryot plugins are currently installed once for the entire server. Installing, updating, listing, or uninstalling a plugin requires the server administrator access token. The active plugin registry, definitions, scripts, providers, imports, integrations, automations, and configuration are therefore instance-global.

Users have a separate plugin-state record, but it only stores presentation order, disabled state, and arbitrary configuration. Runtime scripts do not read this configuration. They read environment variables associated with the global plugin instead. Allowing normal users to call the existing installation endpoint would consequently expose one user's plugin to every user, permit one user to replace another user's plugin by slug, and preserve incorrect system-level execution authority.

Ryot ships first-party media and fitness plugins with every server installation. These trusted plugins need instance configuration, system boot behavior, and system cron behavior. Requiring each user to configure them would be incorrect. User-uploaded plugins instead need private ownership, validated per-user configuration, user-scoped execution, and portable backup behavior.

The current backup archive records per-user plugin state and exact global plugin version requirements, but it does not include private plugin source packages. The archive must be replaced because a user backup needs enough information to recreate private plugins without exporting secret configuration.

The Rust V1 migration remains supported. Its legacy bootstrap currently assumes globally unique plugin and provider slugs, hardcodes first-party plugin ownership for integrations and saved views, and migrates users after first-party plugins are globally loaded. It must create and resolve system plugin installations under the new ownership model without rerunning bootstrap behavior that duplicates migrated data.

## Solution

Introduce an explicit distinction between a plugin and a user's installation of that plugin.

A plugin is the stable identity and current source package. It owns its manifest, source files, compiled scripts, providers, definition namespace, version, and source hash. A plugin is either a trusted system plugin or a private user plugin. System plugins are ingested from the shipped plugin directories. A private plugin is owned by the user who uploaded it and cannot be installed by another user.

A plugin installation associates one user with one plugin. It owns user-controlled disabled state, ordering, validated configuration, lifecycle health, and timestamps. Every user receives installations for all current system plugins automatically. A user may install one private plugin for each slug. Different users may own unrelated private plugins with the same slug and may run different versions.

System and private plugins have different trust and configuration rules. System plugins read environment configuration and retain system boot and system cron behavior. Private plugins read installation configuration, cannot declare system boot behavior, run installation bootstrap once with user authority, and run cron entries separately for their owner with user authority.

All registries and runtime resolution become user-scoped. A user's effective registry consists of the system plugins installed for that user plus that user's private installations. Definition and runtime collisions are rejected within this effective registry but do not affect unrelated users. Persisted plugin-defined data records the stable owning plugin identity in addition to the local definition slug so that the same slug may safely exist in different user namespaces and historical data remains attributable after disablement or updates.

Replace the existing backup archive implementation with format version 2. Version 2 includes exact private plugin packages and non-secret installation configuration. It records shipped system plugins as exact requirements. Restore compiles private packages before writing domain data, skips installation bootstrap, restores plugin-owned data with remapped plugin identities, and leaves installations that lack redacted required secrets unavailable until the user configures them.

Adapt Rust V1 legacy bootstrap to create system plugin installations for migrated users, resolve definitions and providers through trusted system plugin identities, attach migrated integrations and saved views to the correct user installations, and preserve the existing intentional ownership and omission rules.

## User Stories

1. As an authenticated user, I want to upload a private plugin, so that I can extend my account without a server administrator.
2. As an authenticated user, I want my uploaded plugin to remain private, so that other users cannot inspect or execute my code.
3. As an authenticated user, I want another user to be able to use a different plugin with the same slug, so that unrelated private plugins do not conflict across accounts.
4. As an authenticated user, I want to run a different plugin version from another user, so that plugin updates are not instance-wide.
5. As an authenticated user, I want installation input validated and compiled before activation, so that invalid plugins do not enter my runtime registry.
6. As an authenticated user, I want to provide plugin configuration during installation, so that the plugin can be ready without administrator-managed environment variables.
7. As an authenticated user, I want configuration defaults and validation rules from the manifest to be applied, so that installation behavior matches the plugin contract.
8. As an authenticated user, I want configuration errors reported before activation, so that a plugin cannot run with malformed values.
9. As an authenticated user, I want secret configuration values hidden from API responses, so that credentials are not exposed after submission.
10. As an authenticated user, I want to update selected configuration values without resubmitting unchanged secrets, so that routine edits are safe.
11. As an authenticated user, I want to explicitly clear a configured value, so that clearing is distinct from preserving an omitted value.
12. As an authenticated user, I want to see whether required secrets are configured, so that I can diagnose an unavailable plugin without reading the secret.
13. As an authenticated user, I want to list my effective system and private plugin installations, so that I can understand what is available to my account.
14. As an authenticated user, I want system and private plugins clearly identified, so that I understand their ownership and configuration source.
15. As an authenticated user, I want to disable a plugin without deleting its data, so that I can stop execution while retaining historical records.
16. As an authenticated user, I want disabled plugin schemas to remain readable, so that disabling a plugin does not corrupt or hide existing data.
17. As an authenticated user, I want to reorder plugin presentation, so that user-facing consumers can preserve my preference.
18. As an authenticated user, I want to update my private plugin source package, so that I can deploy a new version without administrator access.
19. As an authenticated user, I want an update to preserve my existing secret configuration unless I replace or clear it, so that updates do not unexpectedly remove credentials.
20. As an authenticated user, I want incompatible updates rejected before they affect my current data, so that plugin schema changes cannot silently invalidate records.
21. As an authenticated user, I want to uninstall my private plugin when it has no protected dependencies, so that unused code and configuration can be removed.
22. As an authenticated user, I want uninstall blocked while entities, integrations, or workflows require the plugin, so that uninstall cannot create orphaned data or executions.
23. As an authenticated user, I want system plugins to be installed automatically, so that first-party features work without manual package installation.
24. As an authenticated user, I want to disable a system plugin for my account, so that its user-scoped runtime surfaces can be hidden without removing it from the server.
25. As an authenticated user, I want attempts to uninstall a system plugin rejected, so that shipped server functionality remains consistent.
26. As an authenticated user, I want private plugin operations to execute only in my installation scope, so that another user's operation or configuration cannot be selected.
27. As an authenticated user, I want private plugin providers and imports to execute with my authority, so that their reads and writes remain user-owned.
28. As an authenticated user, I want private integrations tied to the exact installation that defines them, so that an integration cannot authenticate an operation from another plugin.
29. As an authenticated user, I want private plugin automations to process only my data, so that lifecycle events do not cross account boundaries.
30. As an authenticated user, I want private plugin saved views and signals scoped to my installation, so that definition collisions in other accounts do not affect me.
31. As an authenticated user, I want a private plugin's bootstrap entries to run once after installation with my authority, so that the plugin can initialize my account safely.
32. As an authenticated user, I want private plugin cron entries to run separately for my installation with my authority, so that scheduled work cannot gain system privileges.
33. As a server administrator, I want private plugins prohibited from declaring instance boot behavior, so that user code cannot execute with system authority during startup.
34. As a server administrator, I want shipped plugins to continue reading environment configuration, so that shared provider credentials remain centrally managed.
35. As a server administrator, I want shipped plugin boot and cron entries to retain system behavior, so that existing first-party maintenance work continues to operate once per instance.
36. As a server administrator, I want new shipped plugins provisioned for existing users, so that a server upgrade makes first-party functionality consistently available.
37. As a server administrator, I want a shipped plugin update to remain authoritative when it conflicts with a private installation, so that user code cannot block server startup or upgrades.
38. As an affected user, I want a private installation made unavailable with a clear incompatibility reason when a shipped update introduces a conflict, so that historical data remains attributable and the failure is diagnosable.
39. As a plugin author, I want all supported manifest surfaces available to private plugins, so that user-owned plugins are not limited to a temporary subset of Ryot functionality.
40. As a plugin author, I want host capabilities constrained by execution authority even when declared in my manifest, so that capability declarations cannot elevate private code to system authority.
41. As a plugin author, I want durable workflows pinned to the exact installation and compiled script content, so that an update does not change an in-flight execution.
42. As a plugin author, I want HTTP rate-limit declarations resolved from the calling plugin identity, so that another user's declaration for the same origin does not control my requests.
43. As a user creating a backup, I want my private plugin source packages included, so that the backup is portable to another Ryot server.
44. As a user creating a backup, I want schema-marked plugin secrets redacted, so that the archive does not become a credential bundle.
45. As a user creating a backup, I want shipped plugins recorded as exact requirements rather than copied into the archive, so that trusted server code still comes from the destination installation.
46. As a user restoring a backup, I want private packages validated and compiled before domain records are written, so that restore fails before a partial data import when a package is invalid.
47. As a user restoring a backup, I want private plugin identities remapped consistently, so that entities, events, relationships, integrations, and views retain correct provenance.
48. As a user restoring a backup, I want plugin bootstrap skipped, so that bootstrap-created data is not duplicated alongside archived data.
49. As a user restoring a backup, I want installations with missing redacted secrets marked as needing configuration, so that they cannot execute until they are safe to enable.
50. As a user restoring a backup, I want private installations with complete configuration returned to their archived disabled state after restore, so that restore preserves my intent.
51. As a user restoring a backup, I want archives from the removed format rejected clearly, so that unsupported data is not interpreted ambiguously.
52. As an operator migrating Rust V1 data, I want migrated users to receive media and fitness system installations, so that migrated data resolves through the same model as new accounts.
53. As an operator migrating Rust V1 data, I want provider skeletons to retain trusted system-plugin provenance, so that provider population can reconstruct omitted catalog data.
54. As an operator migrating Rust V1 data, I want migrated integrations attached to each owner's media installation, so that integration ownership is explicit.
55. As an operator migrating Rust V1 data, I want legacy feature preferences applied to built-in saved views, so that migration preserves existing presentation choices without disabling entire plugins.
56. As an operator migrating Rust V1 data, I want plugin bootstrap scripts skipped during migration, so that library and other migrated records are not duplicated.
57. As an operator migrating Rust V1 data, I want unresolved package, provider, schema, or installation mappings to fail migration, so that legacy data is never silently dropped or misattributed.
58. As a Ryot developer, I want multi-process plugin registry invalidation to include user-scoped changes, so that all backend processes observe installations and updates consistently.
59. As a Ryot developer, I want package and installation limits enforced before compilation, so that authenticated uploads cannot cause unbounded storage or compiler work.
60. As a Ryot developer, I want plugin ownership represented by database constraints rather than route assumptions, so that background jobs and internal services preserve the same isolation.

## Implementation Decisions

### Terminology And Core Invariants

- A plugin is a stable definition namespace and its current source package. It has a generated ID, slug, scope, optional owner, version, source hash, source file map, manifest, current compiled hashes, lifecycle status, and ingestion timestamps.
- A system plugin has `system` scope and no owning user. Its slug is unique among system plugins. It is ingested only through the trusted shipped-plugin startup path.
- A private plugin has `user` scope and exactly one owning user. Its slug is unique for that owner. It can be created or updated only by that user.
- A plugin installation associates one user with one plugin and has a generated stable ID. It stores user-controlled disabled state, sort order, configuration, lifecycle health, diagnostic reason, and timestamps.
- Each user has at most one installation for a plugin slug in the user's effective registry.
- A private plugin has exactly one installation, owned by the same user. Package sharing and installation by another user are not supported.
- Every current system plugin is automatically installed for every user. System installation rows are explicit rather than inferred, so ordering, disablement, saved-view ownership, and backup behavior have one model.
- The effective registry for a user contains that user's installed system plugins and private plugins. Runtime surfaces require an installation that is healthy and not disabled.
- Definition lookup for persisted data includes installed but disabled plugins. Disablement stops runtime operations, catalogs, automations, crons, and integration execution but does not make historical data undecodable.
- Kernel definitions remain outside plugin ownership. A nullable plugin identity denotes a kernel-owned definition where the relevant schema permits it.
- Plugin source updates retain the stable plugin and installation IDs. Historical content-addressed scripts remain available while durable workflow references require them.
- Source hash, not semantic version alone, is the authoritative package-content identity.

### Persistence Model

- Replace the slug primary key on plugins with a generated plugin ID. Keep slug as a scoped business identifier.
- Add explicit plugin scope and owner columns with database checks that enforce no owner for system scope and one owner for user scope.
- Add scoped unique indexes for system slugs and user-owner slugs.
- Persist the canonical source file map required to reconstruct and back up a private package. Persisting system package source in the same representation is allowed for a uniform ingestion path, but system source is never exported in user backups.
- Replace per-user plugin state with plugin installations. Configuration, ordering, disabled state, and installation lifecycle no longer live in a slug-only overlay.
- Use separate user-controlled disablement and service-controlled lifecycle health. Lifecycle health supports at least installing, ready, needs-configuration, incompatible, and failed states. Runtime activation requires ready health and user disablement set to false.
- Providers belong to stable plugin IDs rather than plugin slugs. Provider slugs are unique within a plugin.
- Compiled scripts belong to stable plugin IDs and remain content-addressed. Current hashes on the plugin identify the active release.
- Provider-operation bindings resolve through the current compiled script set for the owning plugin.
- Durable workflow references include plugin installation ID, plugin ID, script ID, and content hash. This prevents one user's installation or a later package update from satisfying another execution's pin.
- Integrations reference plugin installation ID. Their user ID must equal the installation owner, and their provider must be declared by the installation's plugin.
- Saved views created from plugins reference plugin installation ID. Kernel and custom user views remain distinguishable without a fake plugin installation.
- Persisted entities, events, relationships, signals, subscriptions, and other definition-backed records store the stable owning plugin ID where a local definition slug is otherwise ambiguous. This qualified identity is required for cross-user slug reuse, disablement, updates, backup remapping, and future system conflicts.
- Global provider entities may reference only system plugin providers. Private plugin providers create user-owned entities for their installation owner.
- Existing uninstall fences are converted from global slug checks to exact plugin and installation checks.
- Garbage collection retains scripts, providers, and plugin rows while current installations, domain provenance, integrations, or durable workflow references require them.
- Because no production TypeScript-backend data exists, replace the current V2 schema migration history with a clean baseline if that produces a clearer final schema. Preserve the required Rust V1 ordering in which legacy tables are renamed before the final schema is created and legacy data is copied only after the final tables exist.

### Plugin Ingestion And Installation

- Keep one canonical package decoder, source-path validator, compiler, compiled-manifest verifier, schema-evolution validator, and source hasher for both system and private packages.
- Trusted ingestion is selected by an internal call path and explicit system scope, not only by matching a hardcoded slug.
- Reserve current system plugin slugs against private installation.
- A normal authenticated installation request contains a manifest, source file map, and configuration object.
- Enforce package byte, file-count, source-file, script-count, and compilation limits before expensive compilation. Reuse existing compiler limits and add request-level limits only where current bounds are insufficient.
- Validate a private package against the requesting user's effective registry. Do not validate it against unrelated users' private plugins.
- Validate global host constraints through exact plugin identity. HTTP origins and rate-limit declarations may be reused by unrelated users because authority resolution includes the calling plugin and installation.
- Reject private manifests with instance boot entries.
- Permit the complete existing manifest surface for private plugins, subject to user authority and ownership enforcement.
- Normal installation requires a fully valid configuration after schema defaults are applied. Required missing values reject the request before persistence.
- Persist a new installation in installing health, then run its installation lifecycle through one durable owner.
- The installation workflow executes user-bootstrap entries once, in declared deterministic order, with the installation owner's user authority. It marks the installation ready only after successful completion and marks it failed with a safe reason on terminal failure.
- Installation workflow execution IDs and entry idempotency keys derive from installation ID and bootstrap entry identity.
- Package updates do not rerun user-bootstrap entries. User bootstrap is installation lifecycle, not release migration behavior.
- Updating a package compiles and validates the complete proposed package, checks schema evolution and existing owner data, then atomically changes the plugin's current manifest and compiled hashes.
- A user package update cannot change scope, owner, or stable plugin identity.
- New system package releases are authoritative. Startup reconciliation updates system plugin records and user installations after validating the package itself.
- If a new or updated system plugin conflicts with a private installation, server startup and the system plugin remain available. The private installation becomes incompatible with a safe diagnostic reason and is removed from active runtime resolution. Qualified plugin provenance keeps its historical data attributable.
- Adding a new system plugin creates installations for existing users and dispatches the same user-scoped installation bootstrap workflow. This fan-out uses the durable workflow infrastructure and deterministic installation identities.
- Uninstall is available only for private installations. It is rejected while exact installation data, integrations, dependencies, or nonterminal workflow references require it.
- Successful uninstall deactivates the installation and private plugin. Physical package and script removal remains garbage-collected so in-flight durable references remain valid.

### Configuration

- System plugin scripts continue to read configuration from the existing normalized environment-variable convention.
- Private plugin scripts read configuration only from their exact installation.
- Plugin configuration resolution receives the execution authority and exact script identity. It derives the owning plugin and installation rather than accepting a caller-provided slug.
- A private plugin cannot read configuration under system authority. Private plugin execution is rejected when no matching user installation authority exists.
- Scripts may read only keys listed in their compiled required-plugin-config metadata and declared by the current manifest schema.
- Installation and configuration updates parse values with the canonical property-schema runtime. Do not create a second validation implementation.
- API output omits values for fields marked secret by the manifest schema. It returns a list or map indicating which secret keys are configured.
- Configuration patch input treats omitted keys as preserved. It uses an explicit unset-key collection to clear values; `null` is not overloaded as a clear operation.
- A patch merges preserved stored values, provided replacements, explicit removals, and schema defaults before validating the complete result.
- System installation config remains empty and cannot override server environment values.
- Plugin configuration uses the same database trust assumptions as current integration settings. Plugin-specific encryption, key rotation, and a general secret vault are not introduced by this work.

### User-Scoped Registries And Definitions

- Split registry responsibilities into a process-wide system/package catalog and user-effective registry resolution.
- The package catalog indexes plugins, manifests, providers, scripts, and qualified definitions by stable plugin ID.
- Effective registry resolution loads installation state for one user and combines healthy enabled installations for runtime use.
- Definition resolution can include disabled or unavailable installed plugins when decoding qualified historical data.
- Cache user-effective registry snapshots with an invalidation version. Installation, package, configuration-health, and disablement changes publish centralized Redis invalidations.
- A reconciliation fallback must repair missed invalidations without scanning and rebuilding every user registry on a fixed interval. It may invalidate cached user snapshots by global or per-user generation.
- Script, provider, import-source, integration-provider, operation, workflow, automation-binding, saved-view, schema, signal, and rate-limit indexes use qualified plugin identity internally.
- Human-facing local slugs remain supported at API boundaries only after resolving them in the current user's effective registry. Ambiguous or unavailable slugs fail safely.
- Cross-plugin manifest references are resolved inside one effective registry. An installation cannot reference definitions available only to another user.
- Schema-evolution checks remain additive for persisted definition types and apply to the updating plugin's qualified definitions.
- Query-catalog exposure filters installations and plugin state by the current user and never exposes source, compiled code, or configuration secrets.

### Runtime Authority And Lifecycle

- Every private plugin runtime entry must carry user authority for the installation owner.
- Existing sandbox host capability declarations remain necessary but not sufficient. Each host function continues to enforce authority-specific access independently.
- Provider search, details, and resolution invoked through a private installation use the owner user authority and produce user-owned provider entities.
- Provider operations from system plugins may retain existing global entity behavior where the calling service intentionally uses system provenance.
- Imports resolve their source and workflow through the requesting user's effective registry and pin the exact installation script before dispatch.
- Integrations resolve by installation ID and owner. Integration-authenticated operations verify that the integration belongs to the same installation as the operation.
- User operations resolve by authenticated user and installation before selecting the current script.
- Automations and lifecycle bindings resolve against the data owner's effective registry. Private bindings cannot observe or mutate another user's data.
- Private plugin cron schedules are materialized per ready, enabled installation. Cron execution identity includes installation ID and schedule occurrence, and execution uses owner user authority.
- System plugin cron and boot entries retain one-per-instance system authority behavior and remain independent from per-user disablement.
- Private plugin user-bootstrap entries run only through installation lifecycle. System user-bootstrap entries run when a system installation is first provisioned for a user.
- Disabling an installation stops new runtime dispatch but does not cancel already pinned durable workflows. Existing workflow cancellation semantics remain authoritative.
- All background and HTTP paths use the same scoped resolver and authority checks. No trusted internal path may fall back to a slug-only global lookup for private plugins.

### HTTP Contract

- Plugin management endpoints use normal authenticated user middleware instead of administrator middleware.
- Listing returns the current user's effective installations, including scope, metadata, version, source hash, lifecycle health, safe diagnostic reason, disabled state, order, non-secret configuration, configured-secret indicators, and configuration schema needed by future clients.
- Installation creates a private plugin for the current user from manifest, files, and config. It returns the installation resource after durable installation dispatch.
- Package update addresses the current user's private plugin by slug and accepts the complete manifest and file map plus a configuration patch. System plugins cannot be updated through this endpoint.
- Installation patch changes configuration, explicit unset keys, disabled state, or order without changing source.
- Uninstall addresses only the current user's private installation. A matching system installation returns a conflict response.
- Operation invocation remains under the plugin route but resolves the plugin slug in the authenticated or integration owner's effective registry.
- Use typed bad-request, unauthorized, not-found, conflict, rate-limit, and sandbox errors consistently with the existing contract.
- Remove ordinary plugin installation, update, list, and uninstall from administrator-token authorization. Shipped system ingestion is internal startup behavior, not an administrator upload API.
- Shared contract changes are in scope because the backend implements them. No app-client implementation is included.

### Backup And Restore

- Delete the current archive implementation, fixtures, compatibility branches, and tests for format version 1.
- Implement only archive format version 2. Restore accepts only version 2 and returns an explicit unsupported-version error for all other versions.
- Keep deterministic archive creation, strict codecs, record limits, ZIP validation, hashes, asset verification, and streaming behavior from the existing implementation.
- Add a private plugin package section that records a portable archive plugin key, slug, version, source hash, canonical manifest, and complete source file map.
- Add an installation section that records package key, order, disabled state, lifecycle intent, non-secret configuration, configured-secret redaction pointers, and relevant timestamps.
- System plugin source is not included. The archive manifest records each required system plugin's slug, version, and source hash.
- Persisted records use archive plugin keys rather than database plugin IDs. Export derives these keys from exact qualified provenance.
- Export includes only private packages owned by the exporting user and system installations available to that user.
- Export validates plugin configuration against the current schema before redacting schema-marked top-level secrets.
- Source packages are treated as user-authored data and are not inspected for hardcoded credentials. Documentation should state that only manifest configuration fields can be redacted reliably.
- Restore first validates the archive, verifies system requirements, decodes private packages, compiles them, and validates their complete effective registry without holding the domain restore transaction.
- Restore uses the normal package validation and compiler modules. It uses an internal restore installation path that does not dispatch user-bootstrap lifecycle.
- Restore creates private plugin and installation identities and builds an archive-key-to-plugin-ID map before writing definition-backed domain data.
- All plugin-qualified entity, event, relationship, provider, integration, saved-view, and subscription references are rewritten through this map.
- Restored installations remain runtime-inactive while domain records are written.
- After a successful domain transaction, installations with complete configuration return to their archived disabled state and ready health.
- An installation missing a redacted required secret enters needs-configuration health and cannot execute, even if it was enabled in the archive.
- System plugin config is never exported or restored because its authority remains the destination server environment.
- Restore continues to require a clean destination account. Cleanliness expectations include default system installations and system bootstrap data.
- Restore does not run plugin user-bootstrap because the archive contains the resulting user data. This exception is explicit and limited to restore.

### Rust V1 Legacy Bootstrap

- Rust V1 migration remains a required startup path and is not removed with TypeScript-backend compatibility code.
- Preserve the ordering requirement: detect and rename Rust V1 tables, create the final schema, ingest current trusted system plugins, migrate legacy data, then drop renamed legacy tables.
- Build a legacy package-resolution context after system plugin ingestion. It resolves system plugin IDs, provider IDs, qualified entity schemas, event schemas, relationship schemas, saved-view definitions, integration providers, and user installation IDs.
- Fail migration on missing, inactive, ambiguous, or stale system plugin, provider, schema, or installation mappings. Preserve the existing report-table and fail-on-unexpected-warning policy.
- After legacy users are inserted, create ready media and fitness system installation rows for every migrated user using deterministic, restart-safe set-based work.
- Do not run system plugin user-bootstrap scripts for migrated users. Legacy mapping already creates the library and other equivalent data, and bootstrap execution would duplicate it.
- Continue using normal user bootstrap services for built-in saved views and default notifications where the existing migration intentionally does so, with plugin script dispatch replaced by the existing no-op migration layer.
- Resolve legacy provider targets by explicit system plugin identity plus provider slug. Do not use provider slug as a globally unique key.
- Preserve current provider-entity semantics: referenced provider entities become global skeletons owned by trusted system providers, custom entities remain user-owned, unreferenced provider entities remain omitted, and provider-derived relationships are rebuilt later.
- Store migrated integrations against the owning user's media installation ID and validate their provider settings with the current media manifest.
- Resolve media and fitness saved views through each user's system installations instead of literal plugin-slug columns.
- Preserve legacy feature preferences as built-in saved-view disabled state. Do not reinterpret those preferences as disabling the entire media or fitness installation.
- Rust V1 has no recoverable private TypeScript plugin source package. Do not synthesize private plugins or migrate unsupported plugin state.
- Keep legacy migration validation based on restoring representative Rust V1 dumps and running migration-only mode. Do not add ordinary unit tests to the legacy module.
- Update the legacy migration documentation when ownership, mappings, ordering, or intentional omissions change.

### Deep Module Boundaries

- The plugin package service owns decoding, source validation, compilation, manifest verification, source hashing, schema evolution, trusted-system ingestion, private creation, and private updates behind one interface.
- The plugin installation service owns ownership checks, configuration validation, system provisioning, disablement, lifecycle health, update coordination, and uninstall fencing behind one interface.
- The scoped plugin registry owns effective-registry construction, qualified lookups, collision detection, cache generations, and runtime-versus-definition availability behind one interface.
- The plugin configuration resolver owns environment-backed system config and installation-backed private config behind one authority-aware interface.
- The plugin installation workflow owns exactly-once logical bootstrap orchestration and lifecycle health transitions.
- The plugin cron scheduler owns separate system cron discovery and per-installation private cron discovery while sharing script dispatch primitives.
- The archive codec owns version 2 paths, schemas, deterministic ordering, integrity checks, limits, and portable plugin-key mapping.
- The backup snapshot and restore writer consume the archive codec and scoped registry; they do not parse generic plugin rows independently.
- The legacy package-resolution context centralizes all Rust V1 hardcoded mapping resolution so individual SQL mapping modules receive resolved IDs rather than querying plugin tables inconsistently.
- Repositories remain the only writers for their owned tables. Services choose transaction boundaries, and no transaction spans compilation, sandbox execution, durable workflow boundaries, network calls, or archive streaming.

## Testing Decisions

- Tests assert externally observable ownership, authority, persistence, archive, and lifecycle behavior rather than private helper structure or Effect Schema library behavior.
- Contract tests cover strict install, update, patch, list, and archive version 2 payloads, including rejection of excess fields and unsafe configuration shapes.
- Repository tests cover scoped plugin uniqueness, installation ownership, provider identity, script retention, workflow pins, integration installation references, and garbage-collection fences.
- Package-service tests cover trusted versus private ingestion, source validation, compilation diagnostics, complete-manifest verification, owner-scoped collisions, system slug reservation, schema evolution, and atomic current-package replacement.
- Installation-service tests cover automatic system provisioning, private ownership, configuration merge and explicit unsets, secret-safe output, disablement, health transitions, system uninstall rejection, and exact dependency fences.
- Registry tests cover two users with the same private slug, two users with different versions, system-plus-private composition, qualified definitions, disabled historical definitions, cross-plugin references, and user-local collision rejection.
- Registry invalidation tests cover per-user and global generation changes, Redis publication failure, subscriber reconciliation, and immutable snapshot replacement.
- Configuration tests cover system environment resolution, private installation resolution, authority mismatch, undeclared keys, defaults, required values, secret indicators, and needs-configuration behavior.
- Runtime resolver tests cover exact installation script selection, provider scoping, import and integration catalogs, operation invocation, automation binding ownership, and rejection of stale or incompatible installations.
- Integration operation tests verify that an integration cannot authenticate an operation from another installation, even when both belong to the same user.
- Provider tests verify that private providers create user-owned entities and system providers retain intentional global entity behavior.
- Lifecycle tests cover private boot rejection, installation bootstrap user authority, deterministic idempotency, bootstrap failure health, no bootstrap on package update, system boot authority, system cron authority, and private per-installation cron authority.
- Durable workflow tests verify that update, disablement, or uninstall attempts cannot redirect an existing content-hashed installation pin.
- Backup archive tests replace the existing golden fixture with one version 2 fixture and cover deterministic round trips, private source files, system requirements, plugin-key remapping, secret redaction, hashes, record limits, and unsupported versions.
- Export tests verify that unrelated users' private packages and config are absent and that only schema-marked configuration secrets are redacted.
- Restore tests verify compilation before writes, clean-target checks, exact system requirements, skipped bootstrap, identity remapping, transactional domain rollback, ready restoration, and needs-configuration restoration.
- End-to-end backend tests verify normal user authentication for plugin management, rejection of cross-user access, system plugin protections, operation authority, and private plugin isolation.
- Existing plugin, definitions, sandbox, imports, integrations, schedulers, backup, and user-bootstrap tests provide prior art and should be updated rather than duplicated where they already describe the affected external behavior.
- Rust V1 legacy bootstrap follows its established validation runbook instead of unit tests. Validate at least one normal and one larger available Rust dump through migration-only mode, inspect the migration report, and verify system installations, integrations, saved views, provider provenance, and record counts.
- Run backend type checks and the complete backend test target after focused tests pass. Run affected shared-contract and end-to-end test targets when their contracts or fixtures change.

## Out Of Scope

- App-client changes or user interface implementation.
- A public plugin marketplace, discovery service, ratings, moderation, or publishing workflow.
- Sharing a private plugin package with another user.
- Administrator-uploaded global third-party plugins.
- Plugin package signatures, publisher identities, trust chains, or remote package registries.
- Dependency declarations or automatic dependency resolution between plugins.
- Installing multiple plugins with the same slug for one user.
- Running multiple active releases of one plugin for one user.
- Arbitrary system authority for private plugin code.
- Private instance boot entries.
- Exporting plugin configuration secrets in backups.
- A general encrypted secret vault, application-wide secret migration, or encryption-key rotation system.
- Compatibility with the removed backup archive format.
- Compatibility migration for existing TypeScript-backend plugin or backup data.
- Migration of private plugins from Rust V1, because Rust V1 has no compatible source packages to preserve.
- Redesigning unrelated backup domain records except where qualified plugin identity requires it.
- Weakening existing archive ZIP security, integrity validation, or resource limits.

## Further Notes

- Backend support necessarily changes the shared HTTP contract and backup fixtures even though app-client work is out of scope.
- The stable plugin ID is the definition namespace. The installation ID is the user activation and configuration boundary. The script ID plus content hash is the executable release pin.
- Storing qualified plugin identity on definition-backed data is important. Relying only on user filtering and local slugs would make historical data ambiguous after system updates, disablement, restore remapping, or future namespace conflicts.
- User-authored source files may contain embedded credentials that a manifest cannot identify. Backup redaction guarantees apply to schema-marked configuration, not arbitrary source text.
- System plugin installation fan-out and private installation bootstrap are durable business operations. They must be replay-safe and must not depend on request process lifetime.
- The final implementation should prefer the smallest interfaces that preserve these invariants. It should not introduce package sharing or immutable release catalogs unless implementation evidence shows they are required for script pinning or restore correctness.
