# Ryot: collision-safe plugin identity and schema namespaces

## Implementation brief

Implement this plan on `ultra-rewrite` in `IgnisDa/ryot`.

**Research baseline:** `d8f3f0798647817810776c352a8589836d1cd2d7`, verified on October 13, 2026. This is a source-reviewed implementation specification, not a claim that the proposed implementation has been run or proved by tests. The repository was not modified during planning.

**Goal:** independent plugins may have identical names, slugs, entity schemas, event schemas, relationship schemas, signals, providers, import sources, integration providers, saved views, and client export names without collisions or accidental substitution. Preserve the existing shared-table storage design, system/private authority distinction, and durable execution model.

**Completion means an end-to-end cutover**, including manifests, archives, persistence, definitions, query recipes, mutations, hooks, imports, integrations, client composition, navigation, backups, first-party sources, fixtures, documentation, and tests. Removing duplicate-name validation alone is not completion.

Read the root and applicable child `AGENTS.md` files. The project is greenfield: breaking changes are authorized; compatibility adapters, alternate legacy lookup paths, transitional optional identifiers, and version-suffixed implementations are not. Keep the existing artifact/manifest/API/backup/compiler/protocol version constants. Do not modify legacy-exception code outside this work's dependency surface. Preserve unrelated work already on the branch.

## 1. Decisions already made

These are requirements, not questions to reopen during implementation.

| Area | Required behavior |
|---|---|
| Portable identity | A permanent manifest-assigned UUID identifies an authored package independently of registry, author display name, archive filename, or installation. |
| Local identity | Keep the local `plugin.id`. It identifies one system-owned or user-owned plugin record, not the portable package. Keep installation identity separate. |
| Names | Package name and slug are metadata. Declaration slugs are local to their owner and declaration kind. They are not globally unique. |
| System versions | One active revision per system-owned plugin on a Ryot instance, shared by all its user installations. |
| Private versions | Each user's private plugin record has its own selected revision. Users installing the same package can use different revisions. |
| Data scope | Private plugins never create or mutate global domain data. System plugins may create authorized global data and user-owned data. Personal events/progress remain user-owned. |
| Data sharing | Retain shared system-provider entities. Do not rewrite all data to installation ownership or introduce versioned global entity representations. |
| Schema independence | Same-named or structurally identical schemas from different packages are independent. No inferred equivalence or data adoption. |
| Plugin domain writes | A plugin operates on its own definitions and domain data. No foreign schema extensions, foreign event declarations, or hooks/policies targeting another plugin's schemas. |
| Reads | Retain existing user-scoped cross-plugin RyotQL access. Add no permission system or read-consent/dependency requirement. System-subject reads remain scoped by trusted system-plugin authority. |
| Kernel capabilities | Preserve existing explicit user-authorized kernel facilities, including collection operations. They are not equivalent to unrestricted foreign-plugin domain writes. |
| Installations | At most one active effective installation of a canonical package for a user. Independent forks receive new package IDs. |
| Registry work | Make identity/archives portable. Do not implement a registry client, registry UI, signing infrastructure, automatic updater, or dependency solver in this task. |
| Exact identity conflict | Existing/bundled system package IDs cannot be installed privately. If a newly activated system package conflicts with a pre-existing private claim, system activation succeeds and the private installation is quarantined as incompatible. Preserve its data and exact local references. |
| Upgrade policy | Compatible/additive upgrades only. No plugin-authored migration framework. Version text and hashes do not prove semantic compatibility. |
| Execution policy | One active revision does not mean one stored/executable historical revision. Previously admitted work can continue and eligible retries can use exact historical pins after a normal compatible upgrade. Do not add a strict writer drain/cutover mechanism. |
| Revocation | Historical pins do not bypass current account ownership, quarantine, or existing authority-revocation checks. Quarantine is not a normal upgrade. |
| Portability | Export/import typed plugin references and bind them explicitly to destination-local owners. Never replace arbitrary matching strings in JSON. |
| Recovery | No automatic reactivation or private-to-system data transfer when an identity conflict disappears. Re-enabling the retained private installation explicitly revalidates it. |
| Architecture | Reuse common archive, definition, authorization, persistence, lifecycle, and query primitives for both scopes. Scope changes policy inputs, not the entire implementation path. |

The approved superseding decisions are important: **do not implement the earlier system-activation veto for private package claims, and do not implement drain-before-every-upgrade.**

## 2. Grounded starting points

The following are existing code locations at the baseline, not hypothetical modules.

| Concern | Starting files/symbols |
|---|---|
| Authoring contracts | `packages/contract/src/modules/plugins/manifest.ts`, `schemas.ts`, `plugin-config.ts`; `packages/contract/src/schema/brands.ts` |
| Build/archive | `packages/cli/src/index.ts`; `packages/plugin-archive`; `packages/client-plugin-compiler`; `packages/sandbox-compiler`; `packages/client-plugin-contract/src/artifact.ts` |
| Scoped state | `kernel/backend/src/lib/infrastructure/db/schema/tables/core.ts`: `plugin`, `pluginRevision`, `pluginInstallation`, config revisions and uninstall receipts |
| Definitions/views | `.../schema/tables/definitions.ts`, `views.ts`, `entities.ts`, `events.ts`; `modules/definition-registry/{snapshot,repository,source,kernel-source}.ts` |
| Installation/ingestion | `modules/plugins/{installation-service,installation-repository,repository,service,system-set,system,boot,ingestion-lock,runtime-resolver}.ts` |
| Lifecycle/activation | `modules/plugins/{installation-workflow,revision-activation,layer,catalog-events,ingestion-retirement}.ts`; `modules/integrations/repository.ts` |
| Query language | `packages/contract/src/modules/ryotql/language.ts`; `packages/ryotql`; `packages/ryotql-recipes`; `modules/ryotql/{catalog,expression-kind,validator,normalizer,executor,service}.ts` |
| Domain writes | `modules/entities/{repository,service,mutation-persistence}.ts`; `modules/events/{repository,service,stream-work}.ts`; `modules/relationships/mutation-pipeline.ts` and repositories |
| Provider graphs | `modules/provider-entities/{service,schemas,provider-entity-population-workflow,population,relationship-population,relationship-synchronization,operations-workflow}.ts` |
| Automation | `modules/automations/{planner-resolver,planner,signal-service,notification-subscriptions-service,attempt-repository,history-service}.ts` |
| Sandbox authority | `lib/infrastructure/sandbox-runtime/{execution-principal,plugin-authority,shared,capability-policy,host-functions,automation-host-functions,host-call-gate,service}.ts` |
| Durable work | `modules/sandbox/{repository,sandbox-script-workflow,durable-host-dispatcher,workflow-reference-repository,kernel-workflow-references}.ts`; import runtime and retirement services |
| Other declarations | `modules/plugins/{import-source-catalog,integration-provider-catalog,http-rate-limits,http-rate-limit-authority}.ts`; `modules/integrations`, `modules/imports`, `modules/oauth-connections` |
| Client preparation | `modules/client-pages/{graph,prepare,service,repository,composition,document}.ts`; `modules/client-artifacts` |
| Client contracts/SDK | `packages/contract/src/modules/client-pages/schemas.ts`; `packages/client-plugin-contract/src/index.ts`; `packages/client-sdk`; `packages/client-ui-sdk`; `packages/kernel-renderers` |
| Client routing/storage | `kernel/client/src/routes/_authenticated/$pluginSlug/{route,index,$}.tsx`; `_authenticated/e/$entityId.tsx`; `kernel/client/src/modules`, `api`, `persistence`; `routeTree.gen.ts` is generated |
| Saved views | `packages/contract/src/modules/saved-views/schemas.ts`; `modules/saved-views`; `modules/plugins/saved-view-references.ts` |
| Portable data | `packages/contract/src/modules/imports/data-json.ts`; `modules/plugins/backup-restore.ts`; `modules/backups/archive/schemas.ts` and the backup export/restore pipeline |
| Assembly/tests | `apps/server/tooling/{build,assemble}.ts`; `kernel/backend/src/drizzle`; `kernel/backend/src/lib/test-utils/baseline-migration.ts`; `e2e/{README,AGENTS}.md` |

Backend paths abbreviated with `modules/` or `lib/` above are under `kernel/backend/src/`.

Specific existing traps to remove together:

* `recordBySlug`, `buildDefinitionSnapshot`, and merged definition records assume global uniqueness.
* `validateEffectiveSurfaceSlugs`, shipped-definition claims, custom-view slug collision checks, reserved plugin route slugs, and `reconcilePrivateConflicts` enforce name collisions rather than package identity.
* `user_import_source` and `user_integration_provider` hide a private declaration if a system plugin has its slug. `user_sandbox_provider` checks root schemas by slug without the exact owner.
* Built-in saved-view IDs omit plugin ownership; `saved_view_override` has a user/slug primary key despite carrying `pluginId`.
* Client composition maps, public import specifiers, routes, operation target selection, and device storage use bare plugin slugs.
* Sandbox system-subject RyotQL predicates use owned slug lists without consistently including stored owner IDs.
* Hook matching compares schema slugs; mutation creation can select definitions by slug and derive an owner afterward.
* Backup preparation rejects duplicate private slugs and identifies required system packages by slug; generic data JSON has unqualified schemas/provider references.
* Current system activation callbacks refresh integration projections; they are not a general execution-drain mechanism. Do not repurpose them as one.

## 3. Canonical identity and reference design

### 3.1 Package identity

Add `PluginPackageId`, a branded canonical lowercase UUIDv4 string, in the contract brands/identity surface. Add required `metadata.packageId` to authored and archived manifests. Reject missing, malformed, noncanonical, nil, and changed-on-update IDs. Use `crypto.randomUUID()` only at identity creation, never in a manifest getter, build, installation, or source-hash calculation.

Keep `metadata.slug` and `metadata.name`; allow them to change on an update without changing the package's logical identity. Keep existing local-slug syntax and source-path validation. Removing global uniqueness does not permit invalid paths or arbitrary import specifiers.

Each first-party plugin gets one committed constant in `plugins/<plugin>/shared/plugin-identity.ts`; its host manifest and shared/client/backend recipes import that same constant. Generate one fixed ID each for media, fitness, and fixture. Do not derive these IDs from mutable names or from build output. Test factories preserve package identity for a revision update and generate a different identity only when they mean a different package.

Add a small CLI command `ryot plugin init-identity` that exclusively creates `shared/plugin-identity.ts` in the current package with the generated exported constant. Fail if the file exists; do not rewrite arbitrary TypeScript or create an entire project scaffold. `plugin build` continues to be read-only with respect to authored identity. Document copying the constant into the manifest and assigning a fresh identity to an independently installable fork.

### 3.2 Local runtime ownership

Keep the current `plugin.id`, owner, active revision, installation and config pointers. Add `plugin.packageId`; carry it in stored projections and runtime metadata. The archived manifest ID, owning plugin row and persisted `pluginRevisionSandboxAuthority`/`PluginSandboxAuthority` projections must agree; extend those projections and verification rather than trusting an echoed script field. Uniqueness is:

* One system plugin record per package ID.
* One private plugin record per `(ownerUserId, packageId)`.
* Existing unique `(userId, pluginId)` installation invariant remains.

Use separate partial unique indexes for system and private owners, or the existing scoped-owner expression pattern with package ID instead of slug. Do not use a nullable-column uniqueness definition that accidentally permits duplicate system records. Leave the active-revision ownership foreign key intact.

A package can have a system record and retained quarantined private records. Therefore a database-wide unique package ID would be wrong. Enforce the effective-installation policy transactionally, not by deleting those records.

### 3.3 Definition references

Put canonical schemas/helpers in `packages/contract/src/modules/plugins/references.ts` (new). Derive TypeScript types from Effect schemas; the notation below describes the shape, not a competing hand-written type system.

Runtime definition owner:

```ts
{ kind: "kernel" }
{ kind: "plugin", pluginId: PluginId }
```

Entity, relationship, signal, provider, operation, and declaration references pair this owner with their local slug. Events additionally name their containing entity schema and local event slug. For APIs where an entity ID already fixes the containing entity schema, use that entity's stored identity rather than demand redundant caller-supplied ownership.

Portable plugin selection:

```ts
{ packageId: PluginPackageId, scope: "system" | "user" }
```

The `user` scope means the importing/executing user, never an arbitrary user ID embedded in a portable document. Explicit scope prevents a formerly private reference from binding to a newly introduced system copy with the same claimed UUID. This is a selection discriminator, not an authority grant.

Authored declarations remain local: `rootEntitySchemaSlug`, event nesting, relationship endpoints, hook targets, signal formatter hooks, scripts, workflow targets and `client.entities` resolve against the declaring plugin. Validate them locally. Do not add cross-package schema dependency syntax for those fields.

Use one shared injective key helper for in-memory definition indexes, such as a canonical serialization of `[kind, ownerKind, ownerPluginId, ...localSlugs]`. No manual `slug + ':' + slug` concatenation spread around the codebase; no last-write-wins records. Preserve event nesting where it already simplifies lookup. Reject duplicates within an owner/kind, not across owners.

### 3.4 RyotQL identity expressions

Add one scalar expression, `pluginId`, with a strictly validated reference:

```ts
{ type: "pluginId", reference: { kind: "self" } }
{ type: "pluginId", reference: { kind: "local", pluginId } }
{ type: "pluginId", reference: { kind: "package", packageId, scope } }
```

It evaluates to the exact local plugin ID as text. An unresolved/unauthorized owner is an explicit query diagnostic, not SQL null, an empty string, or a fallback package. Kernel ownership continues to use explicit kernel references/null-aware predicates, not a pretend plugin ID.

Rules:

1. `self` is allowed only when an authoring/materialization context or trusted sandbox principal supplies its exact local owner. Reject unresolved `self` at ordinary user/admin query execution. Do not infer it from workspace, page title, or a unique matching slug.
2. Materialize a plugin-authored saved view's `self` expressions into typed `local` references. Shared recipes accept a reference argument instead of manufacturing owner literals.
3. Browser code uses an explicit nonsecret contributor binding: `usePluginIdentity(packageId)` returns the contributor's exact local plugin reference. Include package ID/local plugin ID/revision metadata in the existing authenticated page/composition context. No bearer token, credentials, or user ID is needed. The helper validates membership in that composition; it is not caller-module authentication. Presentation loaders outside React use each supplied entity reference's exact owner (already selected by the owner-qualified presentation registry), not a React hook or the current workspace. Any non-React contributor lookup shares the same SDK binding accessor; it is not a separate remote authority resolver.
4. A composed Bob component passes Bob's binding to its recipes even when Alice owns the page. Do not have one ambient page-wide `self` binding for all code.
5. On saving a user-owned query, bind its `package` expressions once to `local` references in one catalog snapshot. Store the bound document. Export converts those typed nodes back to `(packageId, scope)`; import binds once to destination-local owners.
6. Ordinary ad-hoc portable queries may resolve their explicit package references at execution. Persisted artifacts must not rebind themselves when the catalog changes.
7. Backup restore may preserve a local reference to a restored quarantined private plugin as unavailable, using the trusted restore map. Do not resolve it through the effective system catalog.
8. This feature makes plugin references portable. It does not make arbitrary entity IDs hidden in user literals or opaque plugin JSON portable; preserve such literals unchanged. Do not claim or implement general string-rewriting portability.

Add a shared AST traversal for this transformation to the defining RyotQL language/builder surface and reuse it for save, export, import, and validation. It must cover all expression-bearing locations, including correlated queries, predicates, joins, row fields, includes, ordering, aggregate measures, time series, JSON-array expressions and nested `first`/`exists`. Do not create a second query compiler.

Expose owner-aware helpers for exact entity, event, relationship and signal selection and definition joins. They compose existing predicates plus `pluginId`; the generic `from: entity/event/relationship` model remains. A raw slug-only predicate remains a deliberately broad query.

### 3.5 Stable URL and saved-view identity

Use one canonical plugin route family for system and private plugins: `/p/<localPluginId>/...`. Entity URLs remain `/e/<entityId>`. Do not retain bare-slug routes, system-only short routes, redirects, collision suffixes, or user-managed routing aliases.

Replace saved-view slug targets with a tagged `SavedViewReference`:

```ts
{ kind: "custom", savedViewId }
{ kind: "kernel", slug }
{ kind: "plugin", pluginId, slug }
```

Canonical saved-view paths are `/v/c/<savedViewId>`, `/v/k/<slug>`, and `/v/p/<pluginId>/<slug>`. Route construction belongs in shared navigation helpers. `ClientPageTarget` uses the reference, and `homeSavedView` stores it instead of a bare slug. Authored plugin `client.homeView` remains a local slug and materializes to its owner-qualified reference.

Custom views remain in their own user namespace; their `pluginInstallationId` is workspace association, not proof that they are plugin-defined. Preserve that distinction in grouping, editing, export and ownership checks. Existing custom-view local uniqueness may remain within the custom namespace; it must not reserve names in a plugin's declaration namespace.

Built-in synthetic row IDs must include user, owner kind/local plugin ID, and local view slug. Generate them through a single specified encoding; use length-framed components when SQL and TypeScript both need to reproduce the ID. Add an equivalence test for both implementations. They must remain stable across ordinary plugin revisions. Do not use revision-specific definition row IDs as logical view identity.

## 4. Work sequence

### Phase 0 — Establish the baseline and fixture intent

Verify branch/working tree before editing. Do not reset existing changes. On a newer branch head, reconcile the named symbol locations while retaining this specification; report substantive behavioral divergence rather than silently dropping requirements.

Read root `AGENTS.md`, `kernel/backend/src/modules/plugins/AGENTS.md`, applicable client/SDK/compiler guidelines, `e2e/AGENTS.md`, and `e2e/README.md`. Root rules specifically require Effect orchestration, no new compatibility paths, no unapproved lint suppressions or type-bypass casts, schema-derived types, and the codebase-cleanup pass.

Create a reusable generic test fixture for independent same-name packages under `e2e/src/fixtures/kernel/plugin-namespaces.ts` (new), using existing build/archive/test-support production paths. Fixture A and B both use metadata name `Whiskey` and slug `whiskey`; share local names `bottle`, `distillery`, `tasted`, `bottled-by`, `catalog`, `all-bottles`, `import`, and an operation/export name. Give them different package IDs, distinguishable property validation and output, and one unique entity schema each. Use fresh package IDs per isolated test case to avoid shared-harness interference, but retain each ID across that test's version variants.

Add an A revision 2 with a compatible optional property and a visibly different operation result. Add a third archive that deliberately claims A's package ID but has different content for identity-conflict tests. Keep fake upstream services hermetic.

**Exit:** fixture meanings clearly distinguish a different package, a new revision, and an identity claim; no test uses a renamed slug to avoid the collision being tested.

### Phase 1 — Contracts, authored identity, and archive/compiler inputs

Change `brands.ts`, plugin manifest/schema contracts, `references.ts`, package metadata responses, upload/update request errors, and test manifest factories. Add the identity initialization command and tests in `packages/cli`.

Thread package identity through CLI client compiler input and artifact metadata. Include it in the canonical client artifact hash metadata and consistency checks so an archive cannot combine one manifest identity with incompatible client identity metadata. Keep immutable bytes hashed by the existing canonical hash calculation. The source/revision digest naturally includes the required manifest ID; do not use version labels as content identity.

Preserve one archive reader/writer for system and private packages. Require the new manifest field and regenerate existing first-party/test archives. Reject old malformed development archives rather than invent an ID at install time. Keep archive limits and version constants; test production-sized first-party archives under existing limits instead of raising them to mask a representation problem.

For default output/assembly filenames and any artifact map keyed by package slug, use package ID (and content digest where the output represents a revision) to prevent two same-slug artifacts overwriting each other. Authored script/provider source paths remain local within their archive; do not prefix every filesystem path with a UUID.

**Exit:** the same authored package builds deterministically with the same identity; two same-name packages produce independent archives; ID-changing updates and manifest/client mismatches fail explicitly.

### Phase 2 — Persistence and qualified SQL views

Update `core.ts` and repository projections (including verified revision authority): add immutable `packageId`, replace slug uniqueness, retain local ID and owner/revision/config relationships. Rename repository selectors to state whether they select by local ID or portable package/owner. Avoid methods called `findById` that actually take a slug.

In `PluginRepository.persist`, source-hash cache lookups and upserts, key the logical plugin by scope/owner/package ID. An explicit update targets a local plugin ID and verifies that the incoming package ID matches it. Metadata renames do not create new plugin records. Persisting the same content is idempotent. Different content with the same version string is a distinct revision, never an overwrite of immutable rows.

Update `definitions.ts` and its generated SQL:

* Thread local `pluginId` and package metadata into all definition projections.
* Remove name-based system-preference `NOT EXISTS` filters from import and integration catalogs.
* Require `rootSchema.pluginId = provider.pluginId`, in addition to local slug and user/effectiveness, in `user_sandbox_provider`.
* Require exact owner identity for entity/event/relationship/signal definition joins. Kernel comparisons use null-safe equality; null is not a wildcard.
* Preserve user/owner and availability predicates independently of namespacing.
* Ensure each user's effective catalog only includes the active revision of that user's private record and the active system revision. Historical stored definition rows must not multiply ordinary joins.
* Keep non-effective definitions available only through deliberate management, backup, retained-data, or pinned-revision repository methods, not by weakening normal catalog visibility.

Update `views.ts`: override uniqueness becomes `(userId, definitionOwner, slug)` with explicit null/kernel behavior. A pair of partial unique indexes is sufficient; do not add a redundant surrogate table/key hierarchy solely because the old nullable composite key is awkward. Make built-in synthetic IDs owner-qualified. Replace `homeSavedViewSlug` with the tagged home-view reference.

Keep existing business-data owner columns and global/user scope. Do not add package/revision/installation IDs redundantly to every event or relationship. Strengthen the existing indexes where exact owner-plus-slug filters/joins need them; use EXPLAIN evidence for any additional index rather than blanket indexing.

Generate DDL with the existing Drizzle workflow. Inspect and repair view dependency ordering and custom immutable-row/authority DDL; do not assume the generator captures every hand-maintained invariant. The baseline loader reads `kernel/backend/src/drizzle/*/migration.sql`; the fresh-database test must execute the complete generated history. Do not ship slug-to-package data guessing. Recreating a disposable development database is allowed, but never erase a database automatically from application startup.

**Exit:** database tests can store duplicate local names under different owners; owner-mismatched root-provider joins do not appear; per-user version selection and shared system pointers remain intact.

### Phase 3 — Definition composition and validation

Replace global `recordBySlug` indexing with qualified keys/accessors in `snapshot.ts`, `repository.ts`, and `source.ts`. Thread qualified references through callers instead of retaining a bare-slug convenience lookup. Wrong-owner references must fail even when a matching local name exists elsewhere.

Make `validatePluginManifestReferences` resolve declaration references within the declaring plugin. Preserve all structural checks, script kinds, file rules, config rules and provider-operation checks. Relationship endpoints are local schemas or the existing explicitly unrestricted endpoint declaration; an unrestricted endpoint does not waive runtime same-plugin ownership checks for plugin-owned relationships. Kernel-owned collection relationships retain their existing cross-plugin semantics.

Remove cross-package duplicate checks (`validateEffectiveSurfaceSlugs`, shipped-definition name claims, custom-view name reservations) and route-name reservations made unnecessary by `/p/<id>`. Retain duplicate checks within one package/declaration kind, including entity-local event duplicates. Kernel schema/local names may match plugin local names without collision. Replace magic handling of kernel `data-json` by an explicit kernel-owned declaration reference; a plugin's local `data-json` must not select the kernel service.

Fix system-set signal formatter validation: do not flatten all scripts and find a formatter by a global script slug. Resolve each signal's hook/script through its owning package; kernel signal formatters stay explicitly kernel-owned.

`materializeSavedView` binds owner-relative references and renderers uniformly. Remove the current entity-browser-specific heuristic that discovers an owner column from settings and injects an ad-hoc filter. First-party/kernel-renderer recipes use the explicit owner-aware helpers instead; do not mutate arbitrary literal strings in settings.

Extend additive compatibility checks to logical identity invariants: no removal/reuse of entity/event/relationship/signal declarations; no event reparenting; no changes to entity merge identity properties, provider root entity schema, or relationship endpoint ownership that would reinterpret existing data. Preserve existing property-schema/user-settings checks. Cosmetic metadata is not logical identity. Providers/exports/operations still referenced by active integrations, saved views or declared client dependencies cannot be removed silently: return a structured referenced-definition compatibility error for the affected update.

**Exit:** A and B compose simultaneously, validate independently, and retain identical local declaration names. Kernel and plugin names do not reserve one another.

### Phase 4 — Transactional installation, system activation, and quarantine

Change installation/update/uninstall/config/home-view endpoints and services to target exact local plugin/installation IDs, not slugs. Use `installationId` for user installation settings and lifecycle commands, and `pluginId` for deployment-level system commands. Retain activation/revision expectations for stale requests. Always verify the current user owns the selected private record/installation.

Normal private install validates the archive before the short ingestion transaction; the transaction rechecks package uniqueness, current system/bundled identity claims and configuration state before persisting. Two concurrent installs of the same package for the same owner produce one record and a deterministic conflict/idempotent outcome. Two different package IDs with the same names both succeed. A hidden, failed or incompatible retained installation still owns its local identity; do not create a replacement record by ignoring non-ready states.

Do not let an ordinary private upload claim any currently system-owned or deployment-reserved bundled package ID, even when that system installation is hidden for the user. The system/bundled identity set is backend-owned and based on package IDs, not manifest display names.

When a system package is first activated and pre-existing private records claim the same package ID:

1. Validate the system candidate normally. Private claims are not a system-activation error.
2. Under the existing ingestion transaction lock, persist/activate the system record and mark the exact conflicting private installations incompatible. Update catalog-invalidating durable records in that same transaction.
3. Make the conflict machine-readable. Add nullable `incompatibilityReason` on installation state with the enum value `package-identity-conflict`, and a check that it is populated only when `health = 'incompatible'`; retain existing `healthReason` for bounded human diagnostics. Resolve the currently conflicting system record from the private record's package ID when rendering details. Do not parse a translated/freeform message to decide authority or reactivation, and do not make quarantine depend on a foreign key to a system record that may later be removed.
4. Preserve private `pluginId`, package ID, active revision, config, all domain rows, saved views, overrides, integrations, subscriptions, and archive contents. Do not mark the private plugin uninstalled or rewrite its package ID.
5. Exclude it from executable/effective catalogs, operation targets, new provider admissions, client code contributors, hooks, crons, integrations and normal schema selection. Its management entry remains visible with the conflict reason, including when normal `user_plugin.is_listed` excludes incompatible installations. Use a management query rather than widening executable catalogs.
6. Invalidate already-prepared private pages and capabilities. Reject fresh host calls/writes from quarantined principals, including expected historical pins. Do not let retained jobs bypass quarantine simply because their bytes/config remain available.
7. Settle pending admissions/retries using the existing retirement/cancellation machinery with a typed installation-unavailable/identity-conflict outcome. Preserve durable history and completed results. Do not delete journals or call a same-name system operation in place of the private target.
8. A host/network call already in flight can finish; no design can undo its completed external effect. Check authority before new effects and again at domain commit where a transaction is involved. System activation must not wait indefinitely for private work.

Acquire locks in existing documented order: ingestion/catalog lock before affected plugin/config/installation and user-write locks; never upgrade a held shared `plugin-config:<id>` lock to exclusive. Domain commits that must exclude quarantine races acquire/check the same relevant persisted authority under transaction locks. No transaction spans sandbox/network execution.

Keep quarantine distinct from ordinary update failure and from hidden intent. Do not set every incompatible installation back to ready in reconciliation. If the conflicting system package is later removed, leave the private installation quarantined until an explicit re-enable/update action validates its original archive, config, definitions and dependencies and clears the incompatibility reason. Its local ID remains unchanged. The existing update/re-enable surface can perform this; do not add an independent recovery framework.

Restoring a backup containing a conflicting private package also preserves it as quarantined instead of blocking the system package or binding its data to that system owner. Ordinary new private upload still rejects the reserved identity; trusted backup restoration is allowed to preserve an unavailable private record and its owned data.

Keep uninstall's existing reference checks. Do not introduce destructive uninstall, force deletion, private package rekeying or data migration. Management must explain that referenced data prevents removal; backups remain available. Account deletion remains the existing deliberate complete-user cleanup path. Do not cascade global system data when one user changes their installation.

**Exit:** no ordinary user can veto system activation by claiming its UUID; quarantine does not retarget or delete data; direct and retained execution both respect it; unaffected same-name packages remain executable.

### Phase 5 — RyotQL binding, owner-aware SQL, and recipes

Implement `pluginId` schema/builder, shared traversal and binding rules from section 3.4. Update every exhaustive expression consumer: schema/type definitions, builder exports, validator, expression-kind inference, normalizer, executor, serialization, tests, cursor/query identity and any cost/size accounting. After binding, inference is `text` and SQL is a bound parameter, not interpolated identifier/raw SQL. No owner lookup per returned row.

Resolve all package references for a document in one persisted catalog snapshot. For normal user requests this catalog is user-scoped; admin requests can use exact local references but cannot use `scope: user` without an explicit server-owned user context. Validate/bind inside the same read transaction used for consistent execution, or pass an already trusted immutable binding captured by that transaction. Do not independently resolve each join/include after a catalog change.

Preserve all existing table visibility, demo restrictions, OAuth/API access checks and limits. Query references select resources, never authorize them. A private `self` does not grant a system-subject query. A user-subject query may intentionally read other visible plugins through explicit references.

Update catalog fields and authorization:

* Expose missing relationship owner identity and consistently expose schema owners for entity, event, relationship and signal definitions/resources.
* System-plugin table authorization requires the trusted local plugin ID **and** the pinned declared schema identity; event scope also includes its containing entity schema. Slug lists alone are insufficient.
* Entity-definition joins include owner and local entity slug. Event-definition joins additionally include containing entity schema; an event named `tasted` under two entity schemas is not the same definition.
* Relationship endpoint traversal validates both relationship owner and endpoint references; generic cross-plugin joins remain legal for authorized user reads.
* Apply ownership to correlated subqueries, includes, aggregate sources and metadata queries, not only root entity filters.
* Kernel-null equality is explicit and null-safe. A missing plugin resolution must never compile as kernel ownership.

Provide a single definition-read context for current user/system catalogs and trusted pinned own-plugin revisions. Owned validation/metadata host calls use the caller's exact pinned revision; foreign user-visible definitions remain current. When a pinned query accesses its own schema-definition projection, use that pin rather than an unrelated active row selected by slug. Ordinary user/UI definitions remain active-revision-specific. Do not globally expose historical definition rows to all user queries.

Refactor first-party and application recipes in `packages/ryotql-recipes`, `plugins/*/shared`, backend contract recipes and kernel-renderer sources. Domain-specific exact-schema queries must pass a qualified owner reference. Keep a deliberately cross-plugin generic entity browser separate from an exact-package browser. Selected entity references carry their real owner; renderers do not infer it from the current workspace.

Saved query save/export/import uses the shared AST traversal, with structured unresolved reference diagnostics. An unresolved reference is a validation error rather than a quietly empty view. Existing stored local references to unavailable/quarantined owners remain attached to that owner and produce unavailable diagnostics, not a system replacement. Pagination/query cache identity includes resolved owner bindings so changing bindings cannot reuse a cursor/cache from another plugin.

**Exit:** user reads can intentionally combine A and B; own-package recipes cannot accidentally combine them; system-subject queries cannot see foreign same-slug data; query round trips never rewrite ordinary string literals.

### Phase 6 — Domain mutation authority and provider graph propagation

At sandbox/operation/kernel-child boundaries, derive a trusted domain-write context from the persisted principal, never from archive arguments:

* Local plugin ID and exact revision/config pin.
* Execution user, if present.
* Permitted data scope and current installation authority.

Thread that context through existing mutation preparation, receipts, policies, commit/replay and durable host inputs. Prefer extending existing trusted execution/preparation structures over introducing a broad new permission framework. HTTP user-owned generic kernel commands retain their existing user authorization; a sandbox kernel-child call must not become an unrestricted kernel command simply because the implementation is kernel code.

For creates, bind the local schema to its owner before decoding properties. For updates/deletes by ID, load the stored owner and verify it against the trusted plugin context. A caller cannot change owner, schema, user or parent by sending a matching local slug. For event operations, verify entity ownership, the entity-local event definition, stored event owner and session context. For relationships, verify definition owner and each endpoint; for plugin-owned relationships, endpoints belong to the same plugin even when the endpoint schema restriction is null. Kernel collection commands retain explicit cross-plugin membership behavior.

Cover all mutation entry points: create/update/delete events; user relationship create/delete batches; global entity/relationship upserts; ordinary entity mutations; ensure/initialization; import-merge/application workflows; generic data JSON; provider populations/translations; event-stream requests; policies and automation descendants. It is not sufficient to check only creation APIs.

Private provider imports must propagate `(userId, localPluginId)` through root, child and related entities, translations, refresh work and relationship reconciliation. Public upstream data does not become globally owned just because the source is public. A provider ID must belong to the same plugin as its root schema and script. Reconciliation deletes only the exact owner's relationship/child set. External-ID deduplication and advisory-lock identities include existing data scope, user where applicable, local schema owner, provider identity and external ID. A same-slug system provider cannot satisfy a private lookup.

System providers retain shared global domain graphs. User-specific state remains user-owned. Use the existing shared storage operations with a trusted scope parameter; do not fork a second provider-population engine for private plugins. Preserve canonical lock ordering and deadlock handling.

Kernel-workflow calls must retain caller authority through `KernelWorkflowReferences`, durable dispatch, child payloads and mutations. Generic import helpers invoked by a plugin may write only that plugin's user/domain scope. Explicit public operation invocation executes the **target** plugin's verified code/installation, rather than lending its authority to the caller or accepting an arbitrary caller-supplied script ID. Existing compiler-derived executable dependency checks remain.

Add private initialization by allowing the existing local `userBootstrap` declaration for both plugin scopes and changing `requiresSystemUserBootstrap` to an exact designated-user-bootstrap requirement. `ensureUserEntities` remains user-subject-only and schema-owner-bound. Populate bootstrap script slugs from the pinned revision for private as well as system plugins in `SandboxRepository`. Reuse `PluginInstallationWorkflow`; validate declarations, config and idempotent seed identity before execution. Bootstrap completion is guarded by the exact installation/activation. It is not a general unrestricted entity-upsert grant. Preserve existing bootstrap invocation timing and receipt behavior rather than introducing migrations or reseeding destructive user state on every update.

Keep private restrictions on deployment-wide HTTP policies, environment secrets and other genuinely deployment-owned capabilities. Do not remove all policy restrictions merely because `userBootstrap` is now supported. Preserve capabilities such as user-subject RyotQL that already work privately; the `requiresSystemPlugin` field is conditional on a system subject in the current policy, not an unconditional private-plugin ban.

**Exit:** negative tests reject foreign same-name writes and global private writes through direct, batch, durable and kernel-child paths; private initialization and full private provider graphs succeed without elevation.

### Phase 7 — Hooks, signals, pinned execution, and compatible upgrades

Qualify immutable lifecycle evidence and hook target matching by exact owner. For new mutation triggers, use the existing transactionally captured applicable catalog, then pin the selected hook/script/config/projection. Retained triggers/runs replay their already selected plans; do not resolve a hook again by slug from the latest catalog. A new mutation performed by a retained script is a new lifecycle request and is subject to the active policies selected at that request's planning boundary; do not silently replace an already retained plan.

Signals and notification subscriptions use `(localPluginId, signalSlug)` or explicit kernel ownership. A formatter/hook name is resolved within that owner. Notification delivery and user subscriptions cannot cross to a same-named signal from another package. Event-stream ownership and processor references carry their exact plugin pin; foreign event/schema IDs cannot be used to request another plugin's processor.

Retain the approved normal-upgrade behavior:

* A new invocation uses the active revision/config selected in a consistent admission transaction.
* An admitted root/child/workflow/retry retains exact plugin, script, config, definition context and executable dependency pins. Do not select a latest revision on replay.
* Old immutable revisions remain eligible for retention/GC while referenced by admitted work or retained retry evidence.
* Current account/installation authority still applies. Normal compatible revision advancement is not revocation; quarantine is.
* Durable current-state reads may observe changed domain data when they are first performed; replayed reads return their recorded results. Do not promise a historical snapshot of the entire database.
* Validate an old writer's payload against its pinned owned declaration and the applicable active storage constraints before a fresh commit. Preserve optimistic row revisions and mutation receipt identity. If a newer record no longer fits what the old executable can process, fail with a structured schema/mutation conflict; do not drop unknown fields, silently coerce units, or switch code/definitions to make it pass. Add a positive ordinary-additive-case continuation test, not just rejection tests.

A system update changes one shared active pointer. A private update changes only the owner's local plugin pointer. Configuration changes and client/integration projection activation must be atomic with their relevant revision pointer. Revalidate compatibility under the ingestion transaction after expensive archive checks. Keep `PluginRevisionActivation`'s integration projection responsibilities; no long-running wait or sandbox activity belongs in that transaction.

Use client request expected revision/source hash to reject **new** stale operations submitted by an old UI; that does not invalidate work already admitted before the update. Distinguish a stale new request from an existing exact-pin retry.

Do not add a general rollback UI or migration runner. Do not assume decreasing the version string is safe: apply compatibility validation to the actual current-to-candidate transition. Retained executable bytes and recovery evidence are not a license to mutate data with incompatible old schemas.

Deployment contract: all running replicas must use the same server/runtime release and deployment configuration. System catalog reads stay database-authoritative, and ingestion is serialized. This task does not promise mixed-server-release rolling upgrades or implement a cluster release coordinator. Update docs accordingly instead of introducing a speculative leader/election service. Concurrency tests must still prove that pointer/config/definition snapshots are not torn and that one active system revision is authoritative.

**Exit:** an A job can continue/retry under A after a compatible B activation; new requests use B; another user's private revision is unaffected; quarantine blocks retained authority without corrupting history.

### Phase 8 — Imports, integrations, schedules, and deployment configuration

Update import source and integration provider catalogs/contracts/UI selection to owner-qualified references. For installed user execution, select by exact installation plus local declaration slug; portable representations carry package ID and scope. Kernel `data-json` is an explicit kernel variant, never inferred solely from its string name.

Preserve the existing integration record's installation association and exact run pins. Remove system-first slug selection from `PluginRuntimeResolver`, import/integration catalogs, settings-schema resolution, script selection and provider search. Same-name declarations must appear as distinct options and create independently owned runs. Provider options and result decoders belong to the selected owner/revision.

Generic `DataJsonDocument` needs explicit schema/provider ownership for each entity/relationship declaration. Existing-entity variants derive and check stored ownership; events resolve through the referred entity. The user-facing kernel importer may deliberately span accessible plugins. A plugin-invoked generic importer preserves the plugin's restricted write context. Update JSON examples, tests, import planning, preview, resolution and merge identities together.

For crons/bootstrap/user schedules, keys contain local plugin or installation ID plus local schedule slug. System schedules remain deployment-scoped; private schedules remain owner-scoped. A private cron is not a system execution. Quarantine removes admission eligibility without altering another package's same-name schedule. Preserve existing schedule/replay IDs where they are already correctly owner-qualified.

Change system environment config naming to an unambiguous identity-based mapping:

```text
RYOT_PLUGIN_<PACKAGE_UUID_WITHOUT_HYPHENS_UPPERCASE>_<NORMALIZED_CONFIG_KEY>
```

Canonical UUID normalization is injective. Continue detecting normalized **config-key** collisions within a package. Update `pluginConfigEnvironmentKey`, manifest validation, configuration loading/errors, deployment examples, first-party docs and test environment fixtures in one cutover. Do not retain `RYOT_PLUGIN_MEDIA_*` as a fallback or add a separate first-party alias path. Private config never consults these environment variables.

Environment configuration remains server-controlled and pinned into exact encrypted config revisions. Do not bind secrets by a user-supplied display slug or archive claim. Preserve OAuth owner/installation checks and declared-field access; qualify any provider keys and dynamic settings choices that are genuinely plugin declarations. External upstream OAuth/provider names are not automatically Ryot plugin identities and should not be mechanically UUID-prefixed.

Keep real global HTTP admission by normalized upstream origin and existing deployment policy. Qualify plugin-local policy labels/IDs so labels do not collide, but do not split a real shared upstream quota into independent per-plugin allowances. Equal compatible policies may coexist under the existing policy rules; genuine conflicting limits for the same resource remain a policy error, not a namespace bug. Private plugins still cannot install deployment-global HTTP policies.

**Exit:** A/B imports, integrations, providers and schedules select the intended owners; kernel data JSON is distinct; environment credentials cannot collide by slug; real shared quotas remain shared.

### Phase 9 — Client composition, routing, storage, and UI

Change client dependency declarations from a global slug array to a map of importer-local aliases to `{packageId, scope}`. Keep author imports readable:

```text
@ryot-app/plugins/<dependencyAlias>/<exportName>
```

At compilation, resolve the alias from the importing package's manifest and emit a canonical target specifier containing scope and full package ID. At composition, bind that target to the exact locally available plugin and active client artifact. Two contributors may use the alias `whiskey` for different packages; their emitted targets must remain distinct. Reject undeclared aliases, missing exports and dependency cycles with structured author diagnostics. Do not auto-install missing dependencies, resolve version ranges, or add a hidden second data instance. Kernel-renderer dependencies use the same portable target representation.

Update compiler import policies, artifact metadata, CLI input, assembly and graph/document generation together. Keep alias rewriting at the existing compiler AST/import-resolution boundary, not a regular-expression rewrite of emitted JavaScript. Graph maps and ordering use exact package selectors/local owner IDs, not name. Import maps, selected exports, CSS/chunk dependencies, artifact grants and contributor metadata must agree. Hashes identify immutable content; local runtime bindings and authorization remain separate. Do not recompile artifacts at installation.

Implement the nonsecret contributor identity binding used by `usePluginIdentity(packageId)` and shared recipes. Carry it in authenticated composition/page data, not credentials. The bridge/runtime must reject bindings absent from the prepared contributor set. Explicitly document that contributors share one realm: this is reliable routing, not mutually isolated module authority.

Implement the route/reference cutover in section 3.5. Update route helpers, sidebar/workspace selection, home routing, deep links, provider-search dialogs, settings actions and client `navigation` APIs. Change the existing `_authenticated/$pluginSlug` route family to the canonical plugin-ID family and regenerate `routeTree.gen.ts` through the existing generator. Do not hand-edit generated routes or retain bare-slug matching when no collision currently exists. Kernel root routes no longer reserve plugin metadata slugs.

Update `ClientPageTarget`, prepared page identities, operation targets, stale-document validation, runtime-realm reuse and graph lookups to exact owners. Preserve the current retained-iframe/navigation architecture; no unrelated iframe performance rewrite. Quarantine invalidation must remove executable private contributors and reject their prepared documents, not navigate automatically to the system copy. A normal update reloads stale UI with the active artifact while preserving already admitted backend work.

Device storage uses exact local plugin ownership along with existing server/user scoping, not a bare plugin slug (the precise tuple is in phase 11). Compatible updates preserve keys; a different package cannot inherit them. Use the shared storage primitive for both scopes. Continue enforcing contributor membership and value/key limits; no new direct iframe localStorage access.

Selectors, management rows, workspace menus, provider/import/integration pickers, query errors and destructive actions show enough metadata to distinguish equal names: display name, system/private status and a package-ID abbreviation, with full package/local identity available in details. Actual option values, React keys and actions use full typed identities. An abbreviated ID is never a machine key. Do not claim publisher verification for user-authored metadata.

Keep unavailable/quarantined private packages visible in management, separate from executable workspace lists. Their error view offers the existing allowed management actions without loading their plugin client code. User-hidden intent, quarantine and installation failure remain distinct states. Selecting a kernel collection or a foreign entity from a cross-plugin query continues to use its real owner renderer.

**Exit:** two Whiskey workspaces and identical saved-view/export names work on desktop and mobile; storage and operations remain isolated by exact owner; stale private pages cannot become system pages.

### Phase 10 — Backup/export/restore and retained ownership

Update the complete archive pipeline, not only `PluginBackupRestore.prepare`.

Archive package keys must include scope and permanent package ID, not name, slug or source-local database ID. Preserve exact revision digest/version metadata. Private archive entries carry their manifest and compiled outputs as today. Required system-package entries carry package identity and the schema compatibility information needed to validate destination compatibility; derive that definition contract from the canonical manifest schemas rather than inventing a parallel schema format. Do not embed system secrets or give an uploaded backup authority to install system executable code.

Build explicit maps before data restoration:

```text
archive package key -> destination local plugin ID
archive installation ID -> destination installation ID
archive entity ID -> destination entity ID
archive custom saved-view ID -> destination saved-view ID
```

Validate duplicate keys/package identities within scope, source hashes, archive structure, declared schema ownership and all referenced keys before the destructive/account-replacement portion of the existing restore pipeline. Do not restore by first matching local slug. Do not search other users' private plugins for a dependency.

Extend archive installation lifecycle intent to preserve the structured incompatibility reason and user-hidden intent separately. An installation exported as quarantined remains non-executable on restore until explicit validated recovery, even if the original conflicting system package is absent at the destination. Carry these maps through user entities, global dependencies, providers, relationships, events, event sessions, integrations, notification subscriptions, saved-view renderers, home-view references, workspace associations and built-in overrides. A private record restored into a destination that has a same-ID system package remains private/quarantined; validation uses the archived private definition and its newly bound private owner, not the system definition. Keep backup management capable of exporting that quarantined record again.

Typed query `local` plugin-ID expressions export as portable scoped references and restore through these maps. Plugin-owned authored `self` references materialize using the newly restored local plugin ID. Kernel renderer settings that currently embed `ownerPluginId` must use the canonical typed reference field and its specific codec so they can be remapped too. Do not recursively rewrite plugin settings/properties/config because a string resembles an ID; opaque plugin JSON remains opaque. Existing explicitly supported entity/asset remapping stays under its own codecs.

System-backed backup dependencies bind only to the destination's matching verified system package, never a private package with a matching ID. An exact digest match is straightforward; a newer compatible system revision is allowed only after the archived definition contract and restored values validate against the destination. Missing or incompatible required system packages fail restore before account replacement. Account restore must never activate, downgrade, replace or reconfigure a system package for the entire instance.

Preserve existing trusted dependency restoration policy, but verify that private-owned archive records cannot request global scope and that restoring one account never overwrites an already-existing shared global system entity from user-supplied snapshots. Global dependency materialization, where already supported, uses verified system ownership and the current trusted restore/validation path, not private-script authority. Unresolved data does not silently attach to a similarly named provider.

Do not infer identity authenticity from a backup's claimed package ID or digest. Archive consistency and destination authority remain separate checks. Restored private secrets follow existing redaction/reconfiguration behavior and never fall back to environment configuration.

**Exit:** two same-slug private packages round-trip into a different user/database with different local IDs; all typed references bind correctly; identity-conflicted private data survives as private/unavailable; system revision/configuration stays unchanged.

### Phase 11 — Retention, caches, diagnostics and full consumer cutover

Audit every use of plugin/schema/provider/view slugs as a map key, cache key, deduplication key, route value, query parameter, selector value, ownership predicate, notification label and deletion filter.

Use stable local owner identity for mutable persistent state and logical locks. Compatible upgrades must not reset preferences, claimed persistent values, import deduplication state or schema identities by automatically adding revision IDs to their keys.

For the generic sandbox cache APIs, use the common canonical tuple encoder with these namespaces:

```text
Disposable cache:
  [executionUserIdOrNull, localPluginIdOrKernel, providerIdOrLocalScriptSlug,
   exactRevisionIdentity, configRevisionIdentityOrNull, authoredKey]

Persistent values/claims:
  [executionUserIdOrNull, localPluginIdOrKernel, providerIdOrLocalScriptSlug, authoredKey]

Device plugin storage:
  [serverIdentity, userIdentity, localPluginId, authoredKey]
```

Use tagged alternatives for provider versus script versus kernel in these tuples, not colliding bare strings. A non-provider script uses its stable local script slug plus owner for persistent state, not its revision-specific script row ID. Kernel scripts use verified kernel identity/content pins as appropriate. Preserve existing restart/TTL semantics. Provider-specific authored keys still include request inputs such as language when those inputs affect results. Do not share user-credential-dependent provider responses just because two users have the same package ID. Private user/config isolation remains mandatory.

Include quarantine state in lifecycle/garbage-collection reasoning. A private installation remains quarantined even after the former conflicting system record is removed; an explicit validated recovery clears its stored incompatibility reason. Retained private records and historical pins protect their necessary definitions/config/artifacts. Do not purge a still-referenced revision or leak private archive bytes merely because another user knows its digest.

Update structured errors and diagnostic parameters so they include exact local IDs and package metadata rather than asking users to distinguish equal slugs. In particular support package-ID mismatch, already-installed package, reserved system identity, identity-conflict quarantine, unresolved query owner, owner mismatch, stale revision and referenced-definition compatibility errors. Preserve existing HTTP status/demo/auth conventions; do not expose other users' private identities through error detail.

Apply the cutover to first-party host/client/backend/shared sources, kernel-renderers, tests, application recipes, default workspace/demo/bootstrap configuration, and any browser-extension or server assembly caller that uses plugin routes or operation targets. Use the same primitives for first-party and uploaded plugins. Rebuild all generated runtime/manifest/client outputs through their existing generators; do not hand-edit generated files or keep version-named variants.

Document the current model in module READMEs and plugin authoring examples: package initialization, local declarations, qualified queries, code-dependency aliases, routes, system/private scope, quarantine, exact-pin upgrades, config names, private bootstrap, export limits and backup behavior. Update child AGENTS rules that currently reserve root URL slugs, forbid private `userBootstrap`, require globally unique fixture slugs, or describe global namespace composition. Do not copy this implementation history into architecture documentation.

**Exit:** no production identity/authorization path depends on a globally unique local name; generated outputs, docs, fixtures and callers all use the new contracts; unaffected legitimate local-slug uses remain simple.

### Phase 12 — Final validation and cleanup

Finish all tests in section 6. Exercise the real archive reader, SQL views, authority reload, durable dispatch and browser bridge; unit tests alone cannot establish end-to-end collision safety.

Before reporting completion, read and execute `.agents/skills/codebase-cleanup/SKILL.md` in the main implementation session. Then run the final checks, migration-from-empty test, artifact build and selected e2e files below. Remove compatibility shims, stale slug checks, unused exports/imports and duplicated parsing left during implementation. Do not add suppressions or casts to silence an incomplete cutover.

The final implementation report records changed surfaces, exact commands/results, known remaining limitations and any failed/skipped acceptance test with its reason. Do not label the work complete while the new same-name fixture fails anywhere in its supported lifecycle.

## 5. HTTP/API cutover decisions

Keep existing endpoint names where practical so callers migrate through the generated typed contract. Change identifier semantics explicitly; do not reuse a parameter called `pluginSlug` for an ID.

| Existing action | Target contract |
|---|---|
| Private install | `POST /plugins` with archive upload token/config. A duplicate package is a conflict, not an implicit update. |
| Private package update | `PUT /plugins/installations/:installationId/package` with upload/config patch and expected active revision/source hash. Incoming package ID must match the selected private record. |
| Private uninstall | `DELETE /plugins/installations/:installationId/:activationId`; retains existing reference checks. |
| Installation state | `PATCH /plugins/installations/:installationId/state`; current-owner checks and explicit quarantine recovery validation. |
| Workspace home | `PUT /plugins/installations/:installationId/home-view` with tagged saved-view reference or null. |
| User preferences | Existing `/plugins/installations/:installationId/user-settings` paths remain exact-installation-based. |
| Operation invocation | `POST /plugins/:pluginId/operations/:operationSlug`; resolve the verified user/integration context and exact local target; retain source-hash expectation where the client supplies it. |
| Catalog stream | Existing `/plugins/events`; do not change stream semantics merely for namespacing. |
| Deployment system actions | Existing admin group, with local `pluginId` targets and explicit update expectations. Admin installation of an already-present package does not silently update it. |

System boot synchronization is a trusted explicit reconciliation operation, not the public install command: it may update an existing system package by its permanent ID after compatibility checks. Keep a shared lower-level ingestion primitive rather than implementing archive validation twice. For public admin use, split create/update intent in the existing admin contract so update names the exact local plugin and expected revision. Preserve existing authentication middleware/group placement and typed error response conventions.

Update stale OpenAPI descriptions that currently say private installation compiles source; installation validates precompiled archives and does not compile them. Preserve the no-recompile installation architecture.

## 6. Required regression matrix

Add most narrow cases to existing colocated tests. Add the named e2e suites in section 7 for cross-module acceptance. Use production service paths and typed test-support/fixtures, not module mocks, arbitrary DB mutation, or public script-execution bypasses.

### Identity, archive and persistence

| ID | Scenario | Required result |
|---|---|---|
| I1 | Different packages have identical metadata names/slugs and overlapping declarations | Both install and remain independently addressable. |
| I2 | Install A then B versus B then A | Same resolved ownership and behavior; no precedence by order. |
| I3 | Same package uploaded twice for one owner | No second installation; explicit conflict/idempotent retry semantics. |
| I4 | Same package installed privately by two users at different revisions | Distinct local plugin/config/data identities and independent active revisions. |
| I5 | Missing/invalid/noncanonical package UUID | Rejected before persistence; build/install never invents one. |
| I6 | Metadata rename versus package-ID change on update | Rename retains identity; package-ID change rejects. |
| I7 | Same version string, different archive bytes | Immutable revisions stay distinct; no overwrite by label. |
| I8 | Manifest/client artifact package mismatch or tampered hash | Rejected using shared archive/artifact checks. |
| I9 | Concurrent installs and install/update races | Database constraints plus transaction rechecks prevent duplicates/stale overwrite. |
| I10 | Duplicate declaration within one owner/kind | Rejected; same event slug under different owned entity schemas remains valid. |

### Queries, definitions and rows

| ID | Scenario | Required result |
|---|---|---|
| Q1 | Exact A bottle query; exact B bottle query | Correct owner and correct property decoder for each. |
| Q2 | Intentional user query joining A and B | Allowed under existing visibility policy. |
| Q3 | Slug-only generic user query | Deliberately broad result; exact-schema helpers never emit only that predicate. |
| Q4 | Join entity to definition with equal local names | One intended definition, no duplicate joined rows. |
| Q5 | Nested includes, correlations, aggregate/time series and JSON-array predicates | Typed reference traversal/binding reaches every location. |
| Q6 | Events have equal event slugs under equal entity slugs in different packages | Owner and parent schema distinguish definitions. |
| Q7 | System-subject A query tries B's same-slug entity/event/relationship | Denied/filtered by exact trusted owner, not slug list. |
| Q8 | Kernel schema/saved view/local `data-json` name overlaps plugin declaration | Explicit ownership selects the intended resource; null never means wildcard. |
| Q9 | Package reference is missing, wrong-scope or unavailable | Structured error; no fallback/null/empty-result substitution. |
| Q10 | Save/export/restore query contains both typed ID nodes and ordinary strings resembling IDs | Typed nodes remap; ordinary strings remain byte-for-byte values. |
| Q11 | Private A revision 1 and another user's revision 2 | Each user's metadata/catalog reflects only their applicable revision. |
| Q12 | Cursor/cache from one resolved owner used with another owner binding | Not reused as the original query's continuation/result. |

### Writes, providers, hooks and capabilities

| ID | Scenario | Required result |
|---|---|---|
| W1 | A attempts B-owned entity/event update or deletion by an obtained ID | Rejected even with equal local schema names. |
| W2 | Private root/child/related provider graph import and refresh | All owned domain rows stay under that private user/plugin. |
| W3 | Private direct or durable global upsert | Rejected; no rows/relationships created globally. |
| W4 | Private plugin invokes a generic kernel import child with a foreign/global target | Original write authority remains restricted; no elevation. |
| W5 | Same provider slug and upstream external ID under A and B | No incorrect deduplication or cross-owner reconciliation deletes. |
| W6 | Two user installations of the same system provider import the same entity | Existing shared global deduplication is preserved. |
| W7 | A's before-policy and after-hook see B's same-name schema mutation | No match/execution. A's mutation still invokes A's hooks. |
| W8 | Same signal and formatter/hook slugs in two packages | Subscriptions/formatting/delivery remain owner-bound. |
| W9 | Private local bootstrap calls `ensureUserEntities` | Own user records initialize idempotently; foreign/global targets reject. |
| W10 | Kernel collection contains A and B entities through existing collection capability | Continues working; no general foreign-schema write grant added. |
| W11 | Wrong-owner provider root schema/script and foreign event stream processor | Rejected even when names match. |
| W12 | Missing fields/newer data encountered by an old writer | Explicit validation/conflict; no silent property stripping or owner change. |

### Revisions, quarantine and lifecycle

| ID | Scenario | Required result |
|---|---|---|
| L1 | System revision B activates with multiple user installations | One active system revision governs all new requests. |
| L2 | A admitted workflow suspends; compatible B activates; A resumes/retries | Exact A code/config/owned definition pin remains; positive completion for compatible data. |
| L3 | A client submits a new request after B activation with stale expectation | Structured stale response; not treated as an already-admitted replay. |
| L4 | A private archive claims a future system package ID; system package later activates | System activation succeeds; exact private installation is quarantined. |
| L5 | Quarantine races with page preparation, import admission, retries, or domain commit | No new private authority after the guarded boundary; no retargeting to system. |
| L6 | Private upload claims an already active/bundled system ID | Rejected before installing/executing private code. |
| L7 | System ID conflict affects one of several same-name private packages | Only exact same-package-ID claim is quarantined. |
| L8 | Conflicting system package deactivates | Private record does not reactivate automatically; explicit validation can recover it. |
| L9 | Quarantined package has references | Uninstall does not delete referenced data; management and backup remain available. |
| L10 | Private quarantine with historical expected pin | Pin bytes alone do not restore execution authority; history remains intact. |
| L11 | User removal/hiding of a system installation | No global shared-data deletion or another user's revision change. |
| L12 | GC while old revision, config or quarantined private ownership is retained | Required artifacts/records survive; unreferenced content can still be collected. |

### UI, other catalogs and portability

| ID | Scenario | Required result |
|---|---|---|
| U1 | Two Whiskey workspaces with same page/export/view names, desktop and compact layouts | Distinct routes, keys, labels and operation targets. |
| U2 | Two packages use the same dependency alias for different packages | Compiler/composition binds aliases relative to each importer. |
| U3 | Alice page renders a Bob component/presentation | Bob's recipes use Bob's identity; page owner does not redefine it. |
| U4 | Same device-storage key in A and B | Independent values; compatible A update preserves A's value. |
| U5 | Built-in view overrides and homes share a local slug | Correct owner/override/home; stable IDs across revisions. |
| U6 | Same import/integration/provider/cron local names | All appropriate choices appear and execute independently. |
| U7 | System environment config uses same metadata slug in two packages | UUID-based names do not collide; private upload cannot read them. |
| U8 | Backup two same-slug packages; restore under new local/user IDs | Correct domain/provider/view/renderer/query/subscription bindings. |
| U9 | Backup private package conflicts with destination system package ID | Retained private quarantine, not global data adoption or system replacement. |
| U10 | System backup dependency missing/incompatible at destination | Preflight failure before account replacement; no system version/config change. |
| U11 | Another user knows a private package ID or artifact digest | Does not gain catalog, config or archive access. |
| U12 | Old bare-slug routes/API identity parameters | Removed, not supported by an implicit compatibility path. |

## 7. Acceptance commands and concrete suites

Use a correctly provisioned repository development/test environment. The e2e harness builds artifacts and provisions PostgreSQL, Redis and object storage through its existing setup. Do not change pool sizes, timeouts, worker counts or resource limits to make this refactor pass.

New generic platform suites:

```text
e2e/src/api/kernel/plugin-namespaces.test.ts
e2e/src/api/kernel/plugin-namespace-authority.test.ts
e2e/src/api/kernel/plugin-package-conflicts.test.ts
e2e/src/api/kernel/plugin-revision-scopes.test.ts
e2e/src/api/kernel/plugin-namespace-backups.test.ts
e2e/src/browser/plugin-namespaces.test.ts
```

Keep the fixture under `e2e/src/fixtures/kernel/plugin-namespaces.ts`, exported only through that existing kernel fixture barrel. Reuse `~/support/effect-test`, `it.live`, production admin/private archive install paths and hermetic fake providers. Runtime timing unit tests use injected services/TestClock; e2e real-time waits do not use `it.effect`.

Update existing colocated tests rather than only adding parallel suites. Especially preserve/extend:

```text
kernel/backend/src/modules/plugins/installation-service.test.ts
kernel/backend/src/modules/plugins/runtime-resolver.test.ts
kernel/backend/src/modules/plugins/service.test.ts
kernel/backend/src/modules/plugins/system-set.test.ts
kernel/backend/src/modules/plugins/revisions.integration.test.ts
kernel/backend/src/modules/plugins/backup-restore.test.ts
kernel/backend/src/modules/plugins/installation-workflow.test.ts
kernel/backend/src/modules/plugins/schema-evolution.test.ts
kernel/backend/src/modules/client-pages/graph.test.ts
kernel/backend/src/modules/client-pages/prepare.test.ts
kernel/backend/src/modules/automations/planner.test.ts
kernel/backend/src/modules/automations/planner.concurrency.test.ts
kernel/client/src/routes/-plugin-navigation.test.tsx
packages/cli/src/index.test.ts
packages/client-plugin-contract/src/index.test.ts
packages/client-plugin-contract/src/artifact.test.ts
packages/contract/src/modules/plugins/manifest.test.ts
packages/contract/src/modules/plugins/contract.test.ts
```

Also update existing RyotQL traversal/compiler, entity/event/relationship, provider, saved-view, import/integration, archive and SDK tests whose contracts change. Type checking all packages is mandatory; fixture types must not bypass the new identities.

Run from repository root unless a subshell changes directory:

```bash
# Before work: inspect, never reset another contributor's work.
git status --short
git rev-parse HEAD

# After the table/view/schema change.
(cd kernel/backend && bun run db:generate)

# Rebuild generated runtime and application artifacts through existing tasks.
bun turbo --filter=@ryot-app/server build

# Final repository gates required by AGENTS.md.
bun run check
bun turbo --filter='!@ryot-app/e2e' test

# Run new e2e files separately; never invoke the unfiltered whole suite.
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/plugin-namespaces.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/plugin-namespace-authority.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/plugin-package-conflicts.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/plugin-revision-scopes.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/plugin-namespace-backups.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/browser/plugin-namespaces.test.ts'

git diff --check
```

The new e2e filenames are prescribed outputs, not claims that they already exist. Run the affected existing e2e files separately too. Use `git diff --name-only -- e2e` to identify changed existing suites and run their individual paths through the same documented command; do not substitute the entire suite. Large operational/live-provider gates stay opt-in and are not required merely for identifier changes. Provider behavior tests remain hermetic.

Add/extend a PostgreSQL migration-from-empty test using `baselineMigrationStatements` and `applyBaselineMigration`; it must include qualified views, uniqueness/null behavior, retained authority/config pins and both scope variants. Validate real generated SQL, not only an in-memory schema object.

After `.agents/skills/codebase-cleanup/SKILL.md` is executed, rerun final gates affected by cleanup. `bun run check` invokes fixing tools; inspect its diff and do not accidentally include unrelated formatter/linter changes.

## 8. Mechanical completion audit

Use these searches as an inventory, not as instructions to replace every local slug with a UUID. Local declaration names and human metadata remain valid.

```bash
rg -n 'pluginSlug|entitySchemaSlug|eventSchemaSlug|relationshipSchemaSlug|signalSchemaSlug' \
  kernel packages plugins apps/server e2e

rg -n 'recordBySlug|validateEffectiveSurfaceSlugs|findShippedDefinitionClaim|reservedPluginSlugs|homeSavedViewSlug' \
  kernel packages plugins apps/server e2e

rg -n 'findActiveSystemPlugin|findProviderAvailableToUserBySlug|findSchemaProviderBySlug|findOperationAvailableToUser' \
  kernel packages plugins apps/server e2e

rg -n 'pluginDependencies|@ryot-app/plugins/|RYOT_PLUGIN_|saved_view_user_slug_unique|builtin:' \
  kernel packages plugins apps/server e2e

rg -n 'entity_schema_slug|relationship_schema_slug|signal_schema_slug|event_schema_slug' \
  kernel/backend/src
```

For each remaining production match, classify it as metadata, local declaration lookup with an already exact owner, deliberately broad user query, or a bug to fix. There must be no unclassified bare-slug authority/routing/catalog lookup. Do not globally rename columns that are intentionally local slugs; complete the missing owner dimension.

Review especially:

* All `Map`/record construction and `.find()` calls keyed by plugin slug.
* `LIMIT 1` lookups where a qualified owner predicate is absent.
* SQL joins that include user and slug but omit plugin owner.
* Deletion/reconciliation queries scoped by schema/provider slug alone.
* Generic import/kernel-child paths that lose a sandbox's original authority.
* Literal local plugin IDs embedded in app-owned saved queries or known renderer settings.
* Hashes/cache keys and synthetic IDs that omit an owner or unnecessarily include a revision.
* Process-local catalog state; keep catalog authority in persisted database state as required.
* Assumptions that `isHidden`, `isListed`, `isEffective`, `health`, quarantine and uninstalled mean the same thing.
* Backup export helpers that filter out incompatible installations and thereby lose quarantined data.
* A same-name package treated as a fallback renderer/provider/dependency when its owner is unavailable.

## 9. Delivery boundaries

This is one coordinated contract/schema/behavior cutover. Intermediate development commits may exist, but do not deploy a state where collision checks are relaxed while authority, SQL joins, client graph or backups still depend on unique names. Do not add a feature flag/dual implementation to bridge those incomplete stages.

An implementation agent may divide work by these ownership groups after the reference contracts are fixed:

1. Contract/reference/CLI/archive/compiler primitives.
2. Persistence/definitions/query binding and SQL.
3. Installation/authority/domain/lifecycle/imports/integrations.
4. Client composition/navigation/renderers/storage.
5. Backup/first-party recipe/test/document integration.

One integration owner controls shared types, schema/view DDL, source hashes, generated artifacts and final acceptance. Workers must not invent competing owner reference shapes, alternate slug aliases, independent registry identities, or different null/kernel conventions. Parallel work does not waive the final single-path cutover.

Do not implement: registry discovery/download UI, registry signatures, automatic updates, new global/private data representations, shared-schema extension contracts, permission prompts for cross-plugin reads, version-range dependency solving, independent installation version pointers for system plugins, general migrations/rollback, strict writer draining, destructive uninstall, or a mixed-release deployment coordinator.

The final report must distinguish tests actually run from inferred correctness. Source review cannot guarantee that implementation reveals no additional defect. A newly discovered defect must be resolved against these identity/authority invariants or reported explicitly; it must not be hidden behind a fallback or a claim of complete coverage.
