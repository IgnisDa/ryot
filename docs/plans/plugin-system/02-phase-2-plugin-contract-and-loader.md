# Phase 2 — Plugin contract, ingestion, loader

Goal: define the plugin manifest, build the ingestion pipeline and hot-capable loader, and
restructure the `builtins` module into two real plugin packages (`plugins/media`,
`plugins/fitness`) plus a kernel-owned definition set. At the end of this phase the plugins
contain everything that is already declarative or sandboxed (schemas, providers, automations,
bindings, saved views); the five native domain modules stay in the kernel reading from the
registry — they migrate in Phase 3.

## 1. `libs/plugin-kit` — the manifest contract

New workspace lib exporting the manifest types and a `definePlugin` builder (typed literal,
`as const`-friendly). The manifest is data the kernel consumes generically; it must never
require kernel code that only one plugin exercises (Decision 2).

v1 manifest sections (exactly what `builtins/registry.ts` + the definition files encode
today — no more):

```txt
definePlugin({
  metadata: { slug, name, version, description },
  entitySchemas: [...],            // incl. nested eventSchemas — Phase 1 registry shapes
  relationshipSchemas: [...],
  signalSchemas: [...],
  trackers: [...],
  savedViews: [...],
  scripts: [...],                  // source refs + driver manifests (existing
                                   // SandboxScriptMetadata kinds: provider, automation)
  bindings: {
    schemaScriptLinks: [...],      // entity-schema slug ↔ script slug (provider selection)
    entityAutomations: [...],      // { entitySchemaSlug, operation, scriptSlug }
    relationshipAutomations: [...],
    eventAutomations: [...],       // { eventSchemaSlug (qualified), kind, position?, metadata? }
    signalAutomations: [...],
  },
})
```

Phase 3 adds `crons`, `operations`, `workflows`, and `capabilities` sections — do not add
them now (invariant 3). Version is a display/change-detection string; there is no
inter-plugin dependency mechanism (non-goal; the only cross-plugin references are to
kernel-owned definitions like `collection`, which the loader validates).

Placement rationale: `libs/plugin-kit` is imported by plugin packages and by app-backend;
keep it dependency-light (types + `AppSchema` re-exports + builder), like
`@ryot/query-engine`'s dependency-free discipline.

## 2. Plugin packages

Top-level `plugins/` workspace directory **[RECOMMENDED]**:

```txt
plugins/media/    package.json, manifest.ts (definePlugin), schemas/, scripts/{providers,automations}/, shared/
plugins/fitness/  same shape
```

Content assignment when dissolving `apps/app-backend/src/modules/builtins/` (from
`registry.ts` and the definition files; verify each against the source):

- **media**: all media entity/relationship schemas and property schemas, media saved views &
  trackers, all ~52 provider scripts except `exercise.free-exercise-db`, automations:
  `automation.media-association`, `automation.media-entity-updated`,
  `automation.media-relationship-sync`, `automation.review-created`,
  `trigger.auto-complete-on-full-progress`, `trigger.integration-progress-policy`,
  `trigger.radarr-push`, `trigger.sonarr-push`, `trigger.jellyfin-push`; media signal
  schemas (`review.created`, `media.status.changed`).
- **fitness**: `exercise`/`workout`/`measurement` schemas + property schemas, fitness
  tracker/views, `exercise.free-exercise-db` provider, `automation.workout-created`,
  `workout.created` signal schema.
- **kernel-owned definitions** (definition source zero, not a plugin): `collection` entity
  schema, `integration.disabled` signal schema, `automation.notification` script (generic
  delivery mechanics). **[IMPLEMENTER-DECIDES]** the exact split for anything ambiguous —
  the test is Decision 2's litmus, and `media-schema-slugs.ts`-style derivations belong to
  the plugin that owns the schemas.

Multi-file authoring: scripts may import from the package's `shared/` — the compiler bundles
each script entry point into one compiled module. Single-file `.sandbox.ts` isolation is no
longer a constraint inside a plugin package.

## 3. Compiler extension (`libs/sandbox-compiler`)

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
   Drop `isBuiltin` on `sandbox_script`; user-authored scripts are rows with
   `pluginSlug IS NULL`. Superseded plugin-script rows are retained while referenced (GC is
   Phase 4 at the earliest).
5. Load: build the new registry snapshot (Phase 1 registry + plugin definitions + bindings)
   and swap it atomically; publish a Redis invalidation message (other instances rebuild
   from the DB); ingestion of first-party plugins at boot short-circuits compile when
   `sourceHash` matches what is stored.

Boot flow: kernel definitions + `plugins/media` + `plugins/fitness` ingested before the
server accepts traffic (replacing `SeedService` in `app/layers.ts`'s
after-migrations slot). Build-time precompilation (the existing `generated-sandbox` registry
mechanism) survives only as a cache feeding step 5's short-circuit — **[IMPLEMENTER-DECIDES]**
whether to keep it or accept compile-on-first-boot; measure boot time before choosing the
extra machinery.

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
  `auth/service.ts` and `god-mode/service.ts`): this is per-user *state* and moves to a
  dedicated table **[RECOMMENDED]** `notification_subscription_state`
  `(userId, signalSchemaSlug, scriptSlug, isActive, metadata?, timestamps)`, unique on
  `(userId, signalSchemaSlug, scriptSlug)`, following the same definition-vs-state pattern
  as `tracker_state`. Re-point `NotificationSubscriptionsService`, the `automations` rule
  endpoints (surface preserved — plumbing only), `ensureDefaultRules`, and the
  `tests/src/tests/automations/notification-subscriptions.test.ts` suite (assertions
  preserved).

Only after both moves is the `automation_rule` table deleted. `subscription_run` stays; its
`ruleId` FK is replaced by a stable identifier string (`pluginSlug + scriptSlug + target +
operation` for binding-driven runs, or the subscription-state key for user-subscription
runs).

Also delete: `entity_schema_sandbox_script` (links come from `bindings.schemaScriptLinks`),
`builtins/registry.ts`, `builtins/seed.ts`, and the rest of the `builtins` module once its
contents have moved. The `user-bootstrap` module should by now contain no builtin
materialization at all.

## 6. Admin install surface + test fixture

- Contract: small admin-scoped `plugins` group — `install` (upload source bundle; format
  **[IMPLEMENTER-DECIDES]**, a tar/zip of the package or a JSON map of files is fine),
  `uninstall`, `list`. Uninstall policy v1: refuse while any entity rows reference the
  plugin's schemas **[RECOMMENDED]** (revisit for user plugins later); first-party plugins
  are not uninstallable while referenced by boot config.
- E2e fixture: replace `seedBuiltinProviderScript`/`promoteSandboxScript`/
  `cleanupBuiltinProviderScript` (`tests/src/fixtures/sandbox-provider.ts`) with
  `installTestPlugin` — assemble a tiny in-memory plugin source (manifest + one provider
  script built from the same `fakeProvider*` builders), install through the real endpoint,
  uninstall in cleanup. Delete the `testSupport.promoteSandboxScript` /
  `deleteSandboxScript` god-mode endpoints. Every provider-driven e2e test now exercises the
  real loader implicitly.
- Keep the fixture's driver-fault-injection ability (`patchSandboxScript`) working — port it
  to reinstall-with-modified-source, which is more honest anyway.

## 7. New kernel tests (this phase's own coverage)

- Ingestion: manifest validation failures, compile-diagnostic failure, slug collision,
  dangling binding, `/` in slug.
- Loader: atomic swap under concurrent reads (unit-level), boot short-circuit on matching
  hash, hot install → new provider immediately usable (e2e, via the new fixture), uninstall
  refusal while entities reference schemas.
- Evolution diff: additive accepted, each breaking category rejected (unit tests on the
  differ).
- Multi-instance invalidation: unit-test the Redis message → snapshot rebuild path (a
  two-backend e2e is not worth the harness cost now **[RECOMMENDED]**).

## Done criteria

1. `apps/app-backend/src/modules/builtins/` no longer exists; media/fitness definitions and
   scripts live in `plugins/media` and `plugins/fitness`; kernel-owned definitions live in
   the registry module.
2. `automation_rule` and `entity_schema_sandbox_script` tables are gone; lifecycle dispatch
   is registry-driven; automation e2e behavior suites (auto-complete, progress policy,
   notification delivery) green with assertions unchanged.
3. Full e2e suite green using the new install fixture; `promoteSandboxScript` gone from
   `tests/` and contract.
4. Hot-install e2e passes: install fake plugin → search/import through it → uninstall.
5. Boot ingests both first-party plugins; a deliberately corrupted plugin source fails boot
   with a structured error (unit/integration test).
6. Phase gate: backend check + unit tests, e2e suite, app-client check all pass.
