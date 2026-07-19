# Phase 2 — Plugin contract, ingestion, loader

Status: complete. The logical-provider and direct-script refinements completed by the sandbox
single-entrypoint rewrite are recorded inline below.

Goal: define the plugin manifest, build the ingestion pipeline and hot-capable loader, and
restructure the `builtins` module into two real plugin packages (`plugins/media`,
`plugins/fitness`) plus a kernel-owned definition set. At the end of this phase the plugins
contain everything that is already declarative or sandboxed (schemas, providers, automations,
bindings, saved views); the five native domain modules stay in the kernel reading from the
registry — they migrate in Phase 3.

## 1. `packages/plugin-kit` — the manifest contract

New workspace lib exporting Effect Schema manifest contracts, their derived types, and a
`definePlugin` builder (typed literal, `as const`-friendly). The schemas are the runtime source
of truth consumed by ingestion; do not maintain parallel handwritten manifest types. The
manifest is data the kernel consumes generically; it must never require kernel code that only
one plugin exercises (Decision 2).

v1 manifest sections (exactly what `builtins/registry.ts` + the definition files encode
today — no more):

```txt
definePlugin({
  metadata: { slug, name, version, description, icon, accentColor },
                                   // metadata IS the workspace presentation (Decision 20)
  entitySchemas: [...],            // incl. nested eventSchemas — Phase 1 registry shapes
  relationshipSchemas: [...],
  signalSchemas: [...],              // subscribable signals select notificationScriptSlug
  savedViews: [...],
  providers: [...],                  // stable logical identities + standard operation mappings
  scripts: [...],                    // source refs for one direct executable entrypoint each
  bindings: {
    schemaProviderLinks: [...],      // entity-schema slug ↔ provider slug
    entityAutomations: [...],      // { entitySchemaSlug, operation, scriptSlug }
    relationshipAutomations: [...],
    eventAutomations: [...],       // { eventSchemaSlug (qualified), kind, position?, metadata? }
    signalAutomations: [...],
  },
})
```

Phase 3 has added `crons`, `boot`, and `operations`. The remaining steps add workflows,
integration registration, and filesystem capabilities when consumed. Version is a
display/change-detection string; there is no
inter-plugin dependency mechanism (non-goal). Cross-plugin references are limited to manifest
references whose target definitions the loader validates.

**Implementation choice (2026-07-24, owner-confirmed):** manifest references may target
definitions contributed by any currently installed plugin. This includes bindings and structural
references such as a relationship schema's source/target entity schemas. It is reference
validation, not a plugin dependency mechanism: manifests still declare no dependencies or
version constraints, and the loader performs no dependency resolution. Ingestion validates
references against the complete prospective registry snapshot, and uninstall refuses to remove
a plugin when doing so would leave any active plugin manifest reference dangling. This is
required for real-loader e2e plugins to attach fake providers and test relationships to
first-party schemas without retaining test-only mutation seams or weakening existing behavioral
assertions.

Placement rationale: `packages/plugin-kit` is imported by plugin packages and by app-backend;
keep it dependency-light (Effect schemas + derived types + `AppSchema` re-exports + builder), like
`@ryot/query-engine`'s dependency-free discipline.

## 2. Plugin packages

Top-level `plugins/` workspace directory **[RECOMMENDED]**:

```txt
plugins/media/    package.json, manifest.ts (definePlugin), schemas/, scripts/{providers,automations}/, shared/
plugins/fitness/  same shape
```

Content assignment when dissolving `apps/app-backend/src/modules/builtins/` (from
`registry.ts` and the definition files; verify each against the source):

- **media**: all media entity/relationship schemas and property schemas, media saved views,
  all ~52 provider scripts except `exercise.free-exercise-db`, automations:
  `automation.media-association`, `automation.media-entity-updated`,
  `automation.media-relationship-sync`, `automation.review-created`,
  `trigger.auto-complete-on-full-progress`, `trigger.integration-progress-policy`,
  `trigger.radarr-push`, `trigger.sonarr-push`, `trigger.jellyfin-push`; all media signal
  schemas (`review.created`, `media.status.changed`, the content/episode/season/release-date
  change signals, and the person/company association group) and their notification formatter.
- **fitness**: `exercise`/`workout`/`measurement` schemas + property schemas, fitness saved
  views, `exercise.free-exercise-db` provider, `automation.workout-created`,
  `workout.created` signal schema and its notification formatter.
- **kernel-owned definitions** (definition source zero, not a plugin): `collection` entity
  schema, `integration.disabled` signal schema, and its generic notification formatter script.
  **[IMPLEMENTER-DECIDES]** the exact split for anything ambiguous —
  the test is Decision 2's litmus, and `media-schema-slugs.ts`-style derivations belong to
  the plugin that owns the schemas.

**Implementation choice (2026-07-24, owner-confirmed):** under the kernel-purity litmus,
`library` and `in-library` are media-owned because they model media catalog membership rather
than generic kernel mechanics. Media also owns every media/person/company schema and property
schema, every media relationship, all media saved views and signals, all providers except
`exercise.free-exercise-db`, and the named media automations (including Jellyfin/Radarr/Sonarr
push). Fitness owns the exercise/workout/workout-template/measurement schemas, workout
relationships and saved views, `exercise.free-exercise-db`, `automation.workout-created`, and
`workout.created`. Source zero stays deliberately minimal: only `collection`, `member-of`, the
Collections saved view, `integration.disabled`, and its notification formatter. This keeps domain
catalog concepts out of the kernel while retaining generic collection and notification mechanics
there.

**Implementation choice (2026-07-24, owner-confirmed):** notification formatting follows signal
ownership. Each subscribable signal-schema definition declares a `notificationScriptSlug`;
ingestion validates that it resolves to an automation script in the complete prospective
snapshot — where "complete" includes the kernel source-zero scripts, which live outside the
loader snapshot (the static kernel set, persisted as `pluginSlug`-null rows), so the validation
universe must be extended to cover them explicitly. Media owns a formatter for all media
signals, fitness owns a formatter for `workout.created`, and source zero retains only the
formatter for its own `integration.disabled` signal. The formatter is never persisted in
subscription state: dispatch resolves it from the live signal definition at execution time, to
the active plugin script or the content-addressed source-zero script (§5). Existing message
text and notification e2e assertions are preserved.

Multi-file authoring: scripts may import from the package's `shared/` — the compiler bundles
each script entry point into one compiled module. Single-file `.sandbox.ts` isolation is no
longer a constraint inside a plugin package.

## 3. Compiler extension (`packages/sandbox-compiler`)

Extend for plugin bundles: given a package root and the manifest's script entries, compile
each script entry point via the existing `Bun.build` bundling path (`compiler-bundle.ts`)
with the same approved-dependency enforcement and diagnostics user scripts get today.
Deterministic output ordering so content hashes are stable. Compilation of N scripts should
reuse one worker session, not spawn per script.

## 4. Ingestion pipeline (kernel)

`ingestPlugin(source) → NormalizedPlugin`:

1. Validate manifest (Effect Schema decode + referential checks: every binding references a
   declared script/schema; slugs contain no `/`; no collisions with already-loaded plugins or
   kernel definitions).
2. Compile all scripts; fail the whole ingestion on any diagnostic.
3. Content-address: `sourceHash` (manifest + all source files), per-script
   `compiledHash`; record `sourceHash → compiledHash[]`.
4. Persist. **[RECOMMENDED]** storage: new `plugin` table
   `(slug, version, manifest jsonb, sourceHash, ingestedAt, status)` and reuse
   `sandbox_script` rows for compiled modules with a new `pluginSlug` column (keeps the
   execution path — which loads by script row — unchanged) plus `contentHash`; a script
   row is immutable per hash (new version ⇒ new row), enabling workflow pinning in Phase 3.
   Drop `isBuiltin` on `sandbox_script`. Every script row is definition-source-owned: installed
   plugin rows have `pluginSlug` set; the only rows with `pluginSlug` null are immutable,
   content-addressed kernel source-zero scripts. There is no `userId` column or per-user slug
   uniqueness — §8 deletes the legacy per-user script feature that used them, so design the
   storage for this end state.
   Retain the `sandbox_script` table name: it describes the unchanged execution mechanism and
   avoids rename-only churn. Superseded script rows are retained while referenced (GC is Phase 4
   at the earliest).
5. Load: build the new registry snapshot (Phase 1 registry + plugin definitions + bindings)
   and swap it atomically; publish a Redis invalidation message (other instances rebuild
   from the DB); ingestion of first-party plugins at boot short-circuits compile when
   `sourceHash` matches what is stored.

Boot flow: kernel definitions + `plugins/media` + `plugins/fitness` ingested before the
server accepts traffic (replacing `SeedService` in `app/layers.ts`'s
after-migrations slot). Phase 2 considered retaining build-time precompilation as a cache feeding
step 5's short-circuit or accepting compile-on-first-boot, with boot-time measurement deciding
whether the extra machinery was justified.

**Implementation choice (2026-07-23):** compile on first boot, then use the persisted
`sourceHash` short-circuit on subsequent boots. The later single-entrypoint split increased the
production catalog to 142 direct scripts without changing this source-canonical decision.
Re-measure boot cost during Phase 4 performance work rather than restoring a second generated-cache
path. The project owner confirmed the original choice.

Schema evolution diff (hot path only): when an ingestion _replaces_ an existing plugin
version, diff old vs new entity/event/relationship/signal property schemas. Additive changes
(new schemas, new optional properties, widened enums) pass; breaking changes (removed
schemas/properties, type changes, new required properties, narrowed enums) are **rejected**
with a structured error. At boot with a wiped dev DB there is nothing to diff; the rule
protects live data under hot swap.

## 5. Automation dispatch moves off the DB

`automation_rule` holds two row kinds (Decision 15); they get different treatment:

- **Global builtin bindings** (`userId IS NULL`): `automations/lifecycle-dispatch.ts` and
  the event policy/subscription evaluation read these from the registry snapshot instead of
  rows. Their seeding is deleted with `registry.ts`/`seed.ts`.
- **Per-user notification subscriptions** (`userId` set; written by
  `NotificationSubscriptionsService` via the `automations` contract group's
  `installRule`/`activateRule`/`deactivateRule`/`deleteRule`/`listRules`, and by
  `ensureDefaultRules` from `user-bootstrap/bootstrap.ts` — consumers also in
  `auth/service.ts` and `god-mode/service.ts`): this is per-user _state_ and moves to a
  dedicated table **[RECOMMENDED]** `notification_subscription_state`
  `(id, userId, signalSchemaSlug, isActive, metadata?, timestamps)`, unique on
  `(userId, signalSchemaSlug)`, following the same definition-vs-state pattern
  as the per-user workspace state (`plugin_state`, §9). Re-point
  `NotificationSubscriptionsService`, the `automations` rule
  endpoints (surface preserved — plumbing only), `ensureDefaultRules`, and the
  `tests/src/tests/kernel/automations/notification-subscriptions.test.ts` suite (assertions
  preserved).

The state table stores no script slug — persisting a definition-derived slug would re-create the
definition/state conflation this table exists to remove, and would dangle under plugin hot swap
or uninstall. Subscription identity is `(userId, signalSchemaSlug)`; dispatch resolves the
formatter from the subscribed signal definition's `notificationScriptSlug` at execution time. A
subscription row whose signal definition is no longer registered is inert: dispatch skips it and
rule listings omit it (never an error), and the row is retained like any other per-user state.

Only after both moves is the `automation_rule` table deleted. `subscription_run` stays with one
non-null text `ruleId`: the generated notification-subscription-state ID for per-user runs or the
existing deterministic binding ID for manifest-driven runs. It has no foreign key because run
attribution must survive deleting a subscription state or replacing a plugin snapshot.

**Implementation choice (2026-07-24, owner-confirmed):**
`notification_subscription_state.id` is a generated primary key and remains the public
`AutomationRuleId`. Deleting and reinstalling the same `(userId, signalSchemaSlug)`
subscription therefore produces a new ID, preserving the existing API behavior. The durable run
record stores that ID, or the manifest binding's existing deterministic `binding:...` ID, directly
in `subscription_run.ruleId`. This is the run's single durable attribution field.

Also delete: `entity_schema_sandbox_script` (links come from `bindings.schemaProviderLinks`),
`builtins/registry.ts`, `builtins/seed.ts`, and the rest of the `builtins` module once its
contents have moved. The `user-bootstrap` module should by now contain no builtin
materialization at all.

## 6. Admin install surface + test fixture

- Contract: small admin-scoped `plugins` group — `install` (upload source bundle; format
  **[IMPLEMENTER-DECIDES]**, a tar/zip of the package or a JSON map of files is fine),
  `uninstall`, `list`. Uninstall policy v1: refuse while any entity rows reference the
  plugin's schemas **[RECOMMENDED]** (revisit for user plugins later); first-party plugins
  are not uninstallable while referenced by boot config.

**Implementation choice (2026-07-24, owner-confirmed):** the install endpoint accepts a JSON
request body containing the manifest and a relative-path-to-source-text file map. This directly
matches the plugin compiler's existing `Record<string, string>` input, lets tests assemble
plugins in memory, and avoids adding archive extraction machinery and its path-safety surface.

- E2e fixture: replace `seedBuiltinProviderScript`/`promoteSandboxScript`/
  `cleanupBuiltinProviderScript` (`tests/src/fixtures/sandbox-provider.ts`) with
  `installTestPlugin` — assemble a tiny in-memory plugin source (manifest + one provider
  script built from the same `fakeProvider*` builders), install through the real endpoint,
  uninstall in cleanup. Delete the `testSupport.promoteSandboxScript` /
  `deleteSandboxScript` god-mode endpoints. Every provider-driven e2e test now exercises the
  real loader implicitly.
- Replace every Phase 1 use of the temporary `testSupport` in-memory definition installer with
  test plugin source installed through `installTestPlugin`, then delete that installer endpoint
  and its registry mutation helper. Phase 2 is not complete while any fixture references the
  temporary seam.
- Keep the fixture's script-fault-injection ability (`patchSandboxScript`) working — port it
  to reinstall-with-modified-source, which is more honest anyway.

## 7. New kernel tests (this phase's own coverage)

- Ingestion: manifest validation failures, compile-diagnostic failure, slug collision,
  dangling binding, dangling signal `notificationScriptSlug`, `/` in slug.
- Loader: atomic swap under concurrent reads (unit-level), boot short-circuit on matching
  hash, hot install → new provider immediately usable (e2e, via the new fixture), uninstall
  refusal while entities reference schemas.
- Evolution diff: additive accepted, each breaking category rejected (unit tests on the
  differ).
- Multi-instance invalidation: unit-test the Redis message → snapshot rebuild path (a
  two-backend e2e is not worth the harness cost now **[RECOMMENDED]**).

## 8. Remove the per-user sandbox-script feature (Decision 19)

Do this **after** §6 — until the `installTestPlugin` fixture exists, the e2e provider tests
depend on the script-creation API this section deletes.

- **Contract**: delete the `sandbox` group's script authoring/CRUD/compile endpoints.
  Anything in the group the plugin machinery still genuinely needs (execution inspection,
  admin diagnostics) is kept or relocated — **[IMPLEMENTER-DECIDES]** after auditing the
  group's remaining consumers.

**Implementation choice (2026-07-24, owner-confirmed):** delete the public `sandbox` contract
group completely. Its remaining `enqueue` and `getResult` endpoints are low-level execution
hooks used by the e2e suite, not by the application flow: entity import remains available through
the generic `entityImport` surface, while Phase 3 adds declared plugin operations through
`plugins.invoke`. Relocate equivalent execution and result-polling hooks to the admin-gated
`testSupport` group, with an explicit executing-user ID so runtime behavior, user-context host
functions, limits, faults, and per-executing-user cache isolation remain covered against
plugin-installed scripts. Delete assertions specific to the removed public endpoint's
authentication and job-ownership behavior along with that endpoint; preserve sandbox-runtime
behavior assertions.

- **Backend** (`modules/sandbox`): delete the user-facing script authoring service/routes
  and owner-based access checks. The execution services and the compiler service
  (`modules/sandbox/compiler.ts`) survive — ingestion (§4) is now their consumer.
- **Storage**: `sandbox_script.userId` dropped; `pluginSlug` is non-null for plugin scripts and
  null only for immutable, content-addressed kernel source-zero scripts; per-user slug
  uniqueness replaced by the §4 content-addressed scheme. The later single-entrypoint rewrite
  replaced `entity.sandboxScriptId` with stable logical `entity.providerId`; entities without a
  provider keep NULL.
- **Cache semantics**: cache isolation keys on the _executing_ user and logical execution owner.
  Provider-associated scripts use `providerId`, allowing split search/details/resolve/translate
  scripts to share cache state; standalone scripts use `scriptId`.

**Implementation clarification (2026-07-24, owner-confirmed):** the pre-Task-07 runtime cache
key actually used `(serverRunId, scriptId, key)`, so user-owned scripts were isolated only
incidentally by having different script IDs while builtin/plugin script IDs could share entries
across executing users. Removing per-user script ownership exposed that contradiction with
Decision 19. Task 07 therefore makes the intended user boundary explicit. The later provider split
refined the second partition key to `providerId` for provider-associated scripts and `scriptId`
otherwise. The existing lifecycle distinction remains: `getCachedValue`/`setCachedValue` also
include `serverRunId` and reset across backend restarts, while `claimCachedValue` uses the
persistent user/script partition. Userless kernel executions use their own partition. This is the
security-preserving interpretation of the decided per-executing-user isolation rule, not a
continuation of isolation that depended on script ownership.

- **E2e**: `tests/src/tests/kernel/sandbox/` — port execution-semantics/limits/fault coverage to
  scripts installed via `installTestPlugin`; delete authoring-CRUD coverage. Any remaining
  fixture that compiles "through the authenticated script-creation API" moves to the install
  path.
- **Docs**: update the "Sandbox Scripts" and cache sections of `apps/app-backend/AGENTS.md`
  and the sandbox-runtime README where they describe user-authored scripts.

## 9. Remove the tracker concept (Decision 20)

Execute this at the **start** of the §2/§4 boot-cutover slice, before the package manifests
are authored — writing `trackers` sections only to delete them is wasted motion.

- **Manifest** (`packages/plugin-kit`): no `trackers` section; `metadata` carries the workspace
  display fields (`icon`, `accentColor`, `description`). Rework the implemented contract
  accordingly.
- **Registry/loader**: no tracker definitions; the workspace list is the installed plugins'
  metadata merged with per-user state (kernel-owned definitions present no workspace).
- **Storage**: `tracker_state` → `plugin_state` **[RECOMMENDED]** name
  (`userId`, `pluginSlug`, `isDisabled`, `sortOrder`, `config`, timestamps; unique on
  `(userId, pluginSlug)`); `savedView.trackerSlug` → `pluginSlug` (still nullable —
  ungrouped views exist); regenerate the migration; `builtins/trackers.ts` is deleted with
  the module.
- **Contract**: dissolve the `trackers` group — workspace listing joins the definitions read
  surface; keep a single workspace-state update endpoint.
- **E2e**: re-plumb any fixture or suite touching tracker state or `savedView.trackerSlug`
  (assertions preserved). Afterwards, grep `tests/` for `tracker` — remaining hits must be
  about plugins-as-workspaces only.

## Done criteria

Completion note (2026-07-26): all criteria below are complete. Plugin reingestion now also preserves
logical provider IDs while atomically activating newly compiled operation scripts.

1. `apps/app-backend/src/modules/builtins/` no longer exists; media/fitness definitions and
   scripts, including their notification formatters, live in `plugins/media` and
   `plugins/fitness`; kernel-owned definitions and the `integration.disabled` formatter live in
   the registry module with no media/fitness vocabulary.
2. `automation_rule` and `entity_schema_sandbox_script` tables are gone; lifecycle dispatch
   is registry-driven; automation e2e behavior suites (auto-complete, progress policy,
   notification delivery) green with assertions unchanged.
3. Full e2e suite green using the new install fixture; `promoteSandboxScript` gone from
   `tests/` and contract.
4. Hot-install e2e passes: install fake plugin → search/import through it → uninstall.
5. Boot ingests both first-party plugins; a deliberately corrupted plugin source fails boot
   with a structured error (unit/integration test).
6. No user-authored script surface remains (Decision 19): the `sandbox` contract group has
   no script CRUD, every `sandbox_script` row is owned by an installed plugin or kernel source
   zero, and the sandbox e2e suites run against plugin-installed scripts.
7. No tracker concept remains (Decision 20): no `trackers` manifest section, contract group,
   or registry definitions, and no `tracker*` tables/columns; workspace presentation comes
   from plugin metadata merged with `plugin_state`.
8. Phase gate: backend check + unit tests, e2e suite, app-client check all pass.
