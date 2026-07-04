# Plugin System — Phase 2: Plugin Contract, Ingestion, and Loader

This PRD is a thin framing layer. **The authoritative technical spec is the two plan
files**, which this document references rather than restates:

- `docs/plans/plugin-system/00-overview.md` — the vision, the 18-item decision record, the
  verified current-state map, the target architecture, and the cross-phase invariants that
  bind every phase.
- `docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` — the complete Phase 2
  spec: the `plugin-kit` manifest contract, the `plugins/media` and `plugins/fitness`
  packages, the compiler extension, the ingestion pipeline and hot-capable loader, the
  automation-dispatch move off the DB, the admin install surface and test fixture, the new
  kernel tests, and the done criteria.

Read both in full before starting any task. Phase 2 must not begin until Phase 1's done
criteria are all met (`00-overview.md` phase ordering). Where this framing and the plans
appear to conflict, **the plan files win** — including where they name specific file paths,
tables, and modules (the write-a-prd "no file paths / no restating decisions" conventions are
deliberately overridden here because the design phase is already complete and the plans are
the source of truth). Markers in the plans carry force: `[DECIDED]` items are settled and must
not be relitigated; `[RECOMMENDED]` items are defaults you follow unless you find concrete
evidence they are wrong (record deviations in the plan file); `[IMPLEMENTER-DECIDES]` items are
open, and you record the choice you make in the plan file.

## Tasks

**Overall Progress:** 0 of 6 tasks completed

**Current Task:** [Task 01](./01-manifest-contract-and-compiler.md) (todo)

### Task List

| #   | Task                                                                                | Type | Status |
| --- | ----------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Manifest Contract and Compiler Extension](./01-manifest-contract-and-compiler.md)  | AFK  | todo   |
| 02  | [Ingestion Pipeline, Storage, and Loader](./02-ingestion-pipeline-and-loader.md)    | AFK  | todo   |
| 03  | [Plugin Packages and Boot Cutover](./03-plugin-packages-and-boot-cutover.md)        | AFK  | todo   |
| 04  | [Admin Install Surface and Test Fixture](./04-admin-install-surface-and-fixture.md) | AFK  | todo   |
| 05  | [Notification Subscription State Table](./05-notification-subscription-state.md)    | AFK  | todo   |
| 06  | [Codebase Cleanup](./06-codebase-cleanup.md)                                        | AFK  | todo   |

## Problem Statement

Phase 1 moved schema definitions out of Postgres into an in-memory registry fed directly from
the `apps/app-backend/src/modules/builtins/` code, but that code is still a hand-written
prototype living inside the kernel: `registry.ts` is an ad hoc binding manifest, `seed.ts`
still upserts sandbox scripts and automation-rule rows into the DB, media and fitness schemas
are interleaved with kernel-generic ones, and there is no format, contract, or pipeline by
which a self-contained bundle of definitions plus scripts can be validated, compiled, stored,
and loaded. Until that pipeline exists, the migrated domain code (Phase 3) has nowhere to
live, "trusted builtin" and "future user plugin" remain two different code paths, and the
kernel-purity goal (no media/fitness strings, branches, or imports — Decision 2) cannot be
reached because the domain definitions are compiled into the kernel itself.

The full rationale, and why this phase comes second, is in
`docs/plans/plugin-system/00-overview.md` (see "Sequencing rationale": Phase 2 "gives migrated
code a home before any migration starts") and Decisions 2, 3, 9, 12, and 13 of its decision
record.

## Solution

Define one plugin manifest contract (`libs/plugin-kit`), restructure the `builtins` module
into two real source-code plugin packages (`plugins/media`, `plugins/fitness`) plus a small
kernel-owned "definition source zero" set, and build the single ingestion pipeline and
hot-capable loader that both boot-time first-party plugins and future runtime-installed
plugins flow through: validate the manifest → compile every script through the existing
compiler → content-address the source and compiled bytes → persist → build a new registry
snapshot and swap it atomically, publishing a Redis invalidation so other instances rebuild.
The kernel consumes the manifest generically (no field is interpreted in a way only one plugin
exercises), so first-party plugins differ from future third-party ones only in _when_ they are
ingested (boot vs. install).

Alongside the loader, automation dispatch moves off the database: global builtin lifecycle
bindings are read from the registry snapshot instead of `automation_rule` rows, and per-user
notification subscriptions move to a dedicated state table — after which `automation_rule` and
`entity_schema_sandbox_script` are deleted. A small admin-scoped `plugins` contract group
(`install`/`uninstall`/`list`) exposes the real loader, and the e2e provider fixture is
replaced by `installTestPlugin` so every provider-driven test exercises the real loader.

Crucially, this phase moves only what is **already declarative or sandboxed** — schemas,
providers, automations, bindings, saved views. The five native domain modules
(`media-trending`, `media-monitoring`, `episode-resolver`, `metadata-lookup`, `exercises`) and
the import/integration adapter code stay in the kernel reading from the registry; they migrate
in Phase 3. Per cross-phase invariant 3 (syscalls are pulled, not pushed), the manifest's
`crons`, `operations`, `workflows`, and `capabilities` sections are **not** added now.

The complete solution — the exact manifest sections, the content assignment when dissolving
`builtins`, the compiler extension, the five-step ingestion pipeline, the storage changes, the
schema-evolution diff rules, the automation-dispatch split, the install surface, and the
fixture replacement — is specified in
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md`. Do not re-derive it.

## User Stories

Actors: **owner** (authors and ships the first-party plugin bundles), **kernel** (the
domain-agnostic backend that consumes manifests generically), **plugin developer** (future
third-party author, whose install path this phase builds), **plugin package** (a
`plugins/media` or `plugins/fitness` source bundle), **sandbox script** (provider/automation
code inside a package), **admin** (installs/uninstalls plugins through the contract),
**end user** (whose per-user notification subscriptions move to state), **API client**
(`app-client` and the browser extension), and **implementing agent**.

1. As the owner, I want a single typed manifest contract with a `definePlugin` builder, so that
   I author plugin bundles as declarative literals instead of the hand-written `registry.ts`
   prototype (plan §1).
2. As the kernel, I want the manifest to carry exactly the sections `builtins/registry.ts` and
   the definition files encode today (schemas, relationship/signal schemas, trackers, saved
   views, scripts, bindings) and no more, so that I never interpret a field only one plugin
   exercises (Decision 2; plan §1).
3. As the kernel, I want `libs/plugin-kit` kept dependency-light (types + `AppSchema`
   re-exports + builder), so that it can be imported by both plugin packages and app-backend
   without dragging in kernel internals (plan §1 placement rationale).
4. As the owner, I want media definitions and scripts to live in a `plugins/media` package and
   fitness ones in `plugins/fitness`, so that the domain code is self-contained bundles rather
   than interleaved kernel modules (plan §2).
5. As a plugin package, I want my scripts to import from a package-local `shared/` directory
   with the compiler bundling each entry point into one module, so that single-file
   `.sandbox.ts` isolation is no longer a constraint inside a package (plan §2 multi-file
   authoring).
6. As the kernel, I want a small kernel-owned "definition source zero" set (the `collection`
   entity schema, the `integration.disabled` signal schema, the generic
   `automation.notification` delivery script) fed through the same registry mechanism, so that
   generic definitions are not forced into a domain plugin (`00-overview.md` target
   architecture; plan §2).
7. As the implementing agent, I want the ambiguous split between plugin-owned and kernel-owned
   definitions resolved by Decision 2's litmus test, so that anything only one plugin needs
   goes to that plugin (plan §2 `[IMPLEMENTER-DECIDES]`).
8. As the compiler, I want to compile N plugin scripts through the existing `Bun.build` path
   with the same approved-dependency enforcement and diagnostics user scripts get, reusing one
   worker session and producing deterministic output ordering, so that content hashes are
   stable (plan §3).
9. As the kernel, I want an `ingestPlugin(source) → NormalizedPlugin` pipeline that validates
   the manifest (Effect Schema decode + referential checks: every binding references a declared
   script/schema, slugs contain no `/`, no collisions with loaded plugins or kernel
   definitions), so that a malformed bundle never loads (plan §4 step 1).
10. As the kernel, I want ingestion to compile all scripts and fail the whole ingestion on any
    diagnostic, so that a plugin is all-or-nothing (plan §4 step 2).
11. As the kernel, I want ingestion to content-address the source (`sourceHash`) and each
    compiled module (`compiledHash`) and record the `sourceHash → compiledHash[]` mapping, so
    that compiled bytes are identity and Phase 3 workflow pinning is possible (Decision 12;
    plan §4 step 3).
12. As the kernel, I want plugins persisted in a new `plugin` table and compiled modules stored
    as immutable-per-hash `sandbox_script` rows gaining a `pluginSlug` column (new version ⇒
    new row), with `isBuiltin` dropped and user scripts as `pluginSlug IS NULL` rows, so that
    the execution path stays unchanged while superseded rows are retained while referenced
    (plan §4 step 4 `[RECOMMENDED]`).
13. As the kernel, I want loading to build the new registry snapshot (Phase 1 registry + plugin
    definitions + bindings) and swap it atomically, so that reads never observe a half-applied
    plugin (plan §4 step 5; Decision 13).
14. As a second backend instance, I want a Redis invalidation message published on load so I
    rebuild my registry from the DB, so that a hot install propagates across instances
    (Decision 13; plan §4 step 5).
15. As the kernel at boot, I want first-party plugin ingestion to short-circuit compilation
    when the stored `sourceHash` matches, so that unchanged bundles are not recompiled every
    boot (plan §4 step 5; Decision 12).
16. As the kernel, I want the boot flow to ingest kernel definitions + `plugins/media` +
    `plugins/fitness` before accepting traffic, replacing `SeedService` in the after-migrations
    slot, so that the registry is fully populated before serving (plan §4 boot flow).
17. As the implementing agent, I want to decide whether to keep build-time precompilation (the
    `generated-sandbox` cache) or accept compile-on-first-boot after measuring boot time, so
    that the choice is evidence-based and recorded (plan §4 `[IMPLEMENTER-DECIDES]`).
18. As the kernel on a hot update, I want an additive-only schema-evolution diff that accepts
    new schemas / new optional properties / widened enums and rejects removed
    schemas/properties, type changes, new required properties, and narrowed enums with a
    structured error, so that live data is protected under hot swap (plan §4 evolution diff;
    Decision 13).
19. As an in-flight workflow execution, I want to keep my pinned module version across a plugin
    swap, so that a hot update never changes the code a running durable execution is replaying
    (Decision 13) — groundwork this phase's immutable-per-hash rows enable.
20. As the kernel, I want global builtin lifecycle bindings (`userId IS NULL`) read from the
    registry snapshot instead of `automation_rule` rows, with their seeding deleted alongside
    `registry.ts`/`seed.ts`, so that lifecycle dispatch is registry-driven (Decision 15;
    plan §5).
21. As an end user, I want my notification subscriptions moved to a dedicated
    `notification_subscription_state` table (unique on `(userId, signalSchemaSlug, scriptSlug)`,
    following the `tracker_state` pattern), so that per-user state stops living in
    `automation_rule` while the `automations` rule surface is preserved plumbing-only
    (Decision 15; plan §5 `[RECOMMENDED]`).
22. As the kernel, I want `NotificationSubscriptionsService`, the `automations` rule endpoints,
    `ensureDefaultRules`, and the consumers in `auth/service.ts` and `god-mode/service.ts`
    re-pointed at the new state table, so that the user-facing rule surface is unchanged while
    its storage moves (plan §5).
23. As the kernel, I want `subscription_run` kept but its `ruleId` FK replaced by a stable
    identifier string (binding key or subscription-state key), so that execution bookkeeping
    survives the `automation_rule` deletion (plan §5).
24. As the owner, I want `automation_rule` and `entity_schema_sandbox_script` tables deleted
    (schema→script links now come from `bindings.schemaScriptLinks`), along with
    `builtins/registry.ts`, `builtins/seed.ts`, and the rest of the `builtins` module once its
    contents have moved, so that no definition-in-DB machinery remains (plan §5; done
    criterion 1–2).
25. As the kernel, I want `user-bootstrap` to contain no builtin materialization at all by the
    end of this phase, so that bootstrap only creates genuine per-user state (plan §5).
26. As an admin, I want a small admin-scoped `plugins` contract group (`install`, `uninstall`,
    `list`) that installs an uploaded source bundle through the real loader, so that runtime
    installation works through the same pipeline as boot (Decision 9; plan §6).
27. As an admin, I want `uninstall` refused while any entity rows reference the plugin's
    schemas, and first-party plugins non-uninstallable while referenced by boot config, so that
    installed data cannot be orphaned (plan §6 `[RECOMMENDED]`).
28. As the implementing agent, I want the install bundle format left open (tar/zip of the
    package or a JSON file map), so that I pick the simplest workable form and record it
    (plan §6 `[IMPLEMENTER-DECIDES]`).
29. As the implementing agent, I want the e2e provider fixture replaced by `installTestPlugin`
    (assemble a tiny in-memory plugin from the existing `fakeProvider*` builders, install
    through the real endpoint, uninstall in cleanup) and the `promoteSandboxScript` /
    `deleteSandboxScript` god-mode endpoints deleted, so that every provider-driven test
    exercises the real loader (plan §6; done criterion 3).
30. As the implementing agent, I want every Phase 1 use of the temporary `testSupport`
    in-memory definition installer replaced by test plugin source installed through
    `installTestPlugin`, then that installer endpoint and its registry-mutation helper deleted,
    so that no fixture references the temporary seam (plan §6 — Phase 2 is not complete while
    any fixture references it).
31. As the implementing agent, I want the fixture's driver-fault-injection ability
    (`patchSandboxScript`) ported to reinstall-with-modified-source, so that fault injection
    keeps working more honestly through the real loader (plan §6).
32. As the plugin developer, I want the whole pipeline to treat my future bundle identically to
    a first-party one (same manifest, same ingestion, same loader), so that user-authored
    plugins are purely additive later (Decision 3, 9, 13).
33. As a maintainer, I want each touched `CLAUDE.md`/`AGENTS.md`/`README.md` updated where
    conventions changed (the `builtins` module's `CLAUDE.md` semantics move with the code), so
    that documentation follows the code (cross-phase invariant 7).
34. As the owner, I want the branch to stay shippable at the end of the phase — backend `check`
    and unit tests, the full e2e suite, and the `app-client` check all green — so that Phase 3
    starts from a working base (cross-phase invariant 1; done criterion 6).

## Implementation Decisions

Every technical decision for this phase is already made and written down. Rather than restate
them (and risk drift), this PRD points to the exact sections that own them:

- **The manifest contract** — the new `libs/plugin-kit` workspace lib, the `definePlugin`
  builder, the exact v1 manifest sections (and the explicit deferral of `crons`/`operations`/
  `workflows`/`capabilities` to Phase 3), version as a display/change-detection string with no
  inter-plugin dependency mechanism, and the dependency-light placement rationale: plan §1.
- **Plugin packages** — the top-level `plugins/` directory `[RECOMMENDED]`, the package shape,
  the precise content assignment for media vs. fitness vs. kernel-owned definitions (including
  the exact provider/automation/signal-schema lists), the `[IMPLEMENTER-DECIDES]` ambiguous
  split resolved by Decision 2's litmus, and multi-file authoring via `shared/`: plan §2.
- **Compiler extension** — extending `libs/sandbox-compiler` for plugin bundles with existing
  approved-dependency enforcement and diagnostics, one reused worker session, and deterministic
  output ordering for stable hashes: plan §3.
- **Ingestion pipeline and loader** — the five steps (validate → compile → content-address →
  persist → load), the `[RECOMMENDED]` `plugin` table and `sandbox_script` `pluginSlug` /
  `contentHash` columns with `isBuiltin` dropped, the immutable-per-hash rule, the atomic
  snapshot swap, the Redis invalidation, the boot flow replacing `SeedService`, the
  `[IMPLEMENTER-DECIDES]` precompilation-cache question, and the additive-only schema-evolution
  diff (accepted vs. rejected categories): plan §4.
- **Automation dispatch off the DB** — the two-kind split (global bindings → registry;
  per-user subscriptions → new `notification_subscription_state` table), the exact re-point
  list (`NotificationSubscriptionsService`, `automations` endpoints, `ensureDefaultRules`,
  `auth`/`god-mode` consumers), the `subscription_run` `ruleId`→stable-identifier change, and
  the table/module deletions gated on both moves completing: plan §5.
- **Admin install surface and test fixture** — the admin-scoped `plugins` group, the v1
  uninstall-refusal policy, the `[IMPLEMENTER-DECIDES]` bundle format, the `installTestPlugin`
  replacement, the god-mode endpoint deletions, the temporary-seam removal, and the
  `patchSandboxScript`→reinstall port: plan §6.
- **Cross-cutting rules** — kernel purity (no media/fitness strings, branches, or imports; the
  manifest-field litmus; Decision 2), sandbox-only runtime with boot-vs-install as the only
  first/third-party difference (Decision 3), the one-generic-invoke API-surface discipline
  (Decision 9 — no plugin-specific contract endpoints), source-canonical content-addressed
  ingestion (Decision 12), hot-load semantics (Decision 13), slug namespacing with `/`
  forbidden (Decision 18), and the module conventions in `apps/app-backend/CLAUDE.md`: overview
  decision record and cross-phase invariants.

Follow the plan markers when a section leaves room: `[DECIDED]` is fixed, `[RECOMMENDED]` is
the default (deviate only with concrete evidence, and record it in the plan), and
`[IMPLEMENTER-DECIDES]` is yours to settle and record. If implementation uncovers evidence that
a `[DECIDED]` item is wrong, **stop and surface it** rather than silently deviating.

## Testing Decisions

- **What a good test is here:** the e2e suite (`tests/`) is the behavioral spec (Decision 16),
  and this phase migrates it in lockstep — plumbing changes (the provider fixture becomes the
  real loader, god-mode installer endpoints disappear), but **what is asserted stays the same**.
  A behavioral change requires explicit owner sign-off, not a quiet test edit (cross-phase
  invariant 2). Test app-owned behavior and branching, not library behavior, per `AGENTS.md`.
- **New kernel tests this phase owns** (plan §7): ingestion failures (manifest validation,
  compile diagnostic, slug collision, dangling binding, `/` in slug); loader behavior (atomic
  swap under concurrent reads at unit level, boot short-circuit on matching hash, hot install →
  provider immediately usable via the new fixture, uninstall refusal while entities reference
  schemas); the schema-evolution differ (additive accepted, each breaking category rejected);
  and the Redis message → snapshot rebuild path (unit-level — a two-backend e2e is not worth
  the harness cost now, `[RECOMMENDED]`).
- **The `installTestPlugin` fixture is the central test change:** every provider-driven e2e
  test now exercises the real loader implicitly; the `automations` notification-subscriptions
  suite is re-plumbed to the new state table with assertions preserved (plan §5–6).
- **Behavior that must stay green:** the automation e2e suites (auto-complete, integration
  progress policy, notification delivery) with assertions unchanged (done criterion 2), and the
  hot-install e2e (install fake plugin → search/import through it → uninstall; done criterion
  4). A deliberately corrupted plugin source must fail boot with a structured error via a
  unit/integration test (done criterion 5).
- **Prior art:** the existing hermetic provider fixture
  (`tests/src/fixtures/sandbox-provider.ts`) and the `fakeProvider*` builders it uses are the
  starting point for `installTestPlugin`; conventions live in `tests/CLAUDE.md` (update it
  where conventions change). Run e2e and backend tests from their own app directories per
  `AGENTS.md`.
- **The gate** (done criterion 6, cross-phase invariant 1):
  `bun turbo --filter=@ryot/app-backend check` plus backend unit tests
  (`cd apps/app-backend && bun run test`), the full e2e suite (`cd tests && bun run test`,
  using the new install fixture), and the `app-client` check all pass.

## Out of Scope

- **Everything Phase 3+ pulls in** (cross-phase invariant 3 — syscalls are pulled, not pushed):
  the manifest's `crons`, `operations`, `workflows`, and `capabilities` sections; the durable
  workflow engine's sandbox-script bodies and the workflow SDK entry point; file-access
  permission grants for import files; and the generic `invoke` dispatch endpoint. None are
  built now (`00-overview.md` phase table; plan §1).
- **Migrating the five native domain modules** (`media-trending`, `media-monitoring`,
  `episode-resolver`, `metadata-lookup`, `exercises`) and the import/integration adapter code
  into the plugins — they stay in the kernel reading from the registry this phase and move in
  Phase 3 (plan intro; `00-overview.md` Decision 14).
- **Purity enforcement, performance work, plugin GC, limits, and the test-tree
  reorganization** — all Phase 4 (`00-overview.md` phase table; plan §4 notes GC is "Phase 4 at
  the earliest").
- **The general YAGNI non-goals of the whole plan:** no plugin-dependency resolution, no plugin
  marketplace/signing, no public (non-admin) install endpoint, no speculative manifest fields
  (cross-phase invariant 5; plan §1).
- `apps/app-client-backup` (slated for removal — ignore entirely) and the legacy
  `apps/backend`/`apps/frontend` system (untouched by this plan; Decision 17).

## Further Notes

- **No deployment constraints.** All work is local on the `ultra-rewrite` branch; there is no
  CI, `apps/app-backend` is not deployed, dev databases are wipeable, and the single initial
  drizzle migration may be regenerated freely — so the `plugin` table, the `sandbox_script`
  column changes, the `notification_subscription_state` table, and the `automation_rule` /
  `entity_schema_sandbox_script` deletions are done by regenerating the migration, not by
  authoring ALTERs (`00-overview.md` status line).
- **The plans are living documents during implementation.** Record `[RECOMMENDED]` deviations
  and `[IMPLEMENTER-DECIDES]` choices (bundle format, precompilation-cache question, ambiguous
  definition split) by editing the relevant plan file, not this PRD.
- **Pattern discovery before writing.** Per `AGENTS.md`, launch an `explore` subagent to find
  existing patterns to replicate — the existing `libs/sandbox-compiler` bundling path, the
  runtime compiler invocation in `modules/sandbox/compiler.ts`, the `tracker_state` state-split
  pattern from Phase 1, the sandbox-runtime host-call bridge, and the existing provider fixture
  — before writing new code; `explore` is for discovery only.
- **Phase ordering is strict.** Do not begin Phase 2 until every Phase 1 done criterion is met
  (`00-overview.md` phase ordering; Phase 1's PRD marks all three of its tasks done).
- **A mandatory final cleanup task** (following the `codebase-cleanup` skill) will be appended
  when this PRD is broken into tasks — a final pass over the touched files and directly affected
  modules to remove dead, duplicated, or leftover code (notably any residue of the deleted
  `builtins` module and the temporary Phase 1 test seam).
