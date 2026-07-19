# Plugin System — Phase 1: Schema Registry

This PRD is a thin framing layer. **The authoritative technical spec is the two plan
files**, which this document references rather than restates:

- `docs/plans/plugin-system/00-overview.md` — the vision, the 18-item decision record, the
  verified current-state map, and the cross-phase invariants that bind every phase.
- `docs/plans/plugin-system/01-phase-1-schema-registry.md` — the complete Phase 1 spec: the
  registry design, storage/migration changes, the consumer conversion list, the
  tracker/saved-view state split, contract deletions, e2e migration, and done criteria.

Read both in full before starting any task. Where this framing and the plans appear to
conflict, **the plan files win** — including where they name specific file paths, tables, and
modules (the write-a-prd "no file paths / no restating decisions" conventions are
deliberately overridden here because the design phase is already complete and the plans are
the source of truth). Markers in the plans carry force: `[DECIDED]` items are settled and
must not be relitigated; `[RECOMMENDED]` items are defaults you follow unless you find
concrete evidence they are wrong (record deviations in the plan file); `[IMPLEMENTER-DECIDES]`
items are open, and you record the choice you make in the plan file.

## Tasks

**Overall Progress:** 3 of 3 tasks completed

**Current Task:** Phase 1 complete

### Task List

| #   | Task                                                                  | Type | Status |
| --- | --------------------------------------------------------------------- | ---- | ------ |
| 01  | [Build the Definition Registry](./01-build-definition-registry.md)    | AFK  | done   |
| 02  | [FK-to-Slug Storage and Consumer Cutover](./02-fk-to-slug-cutover.md) | AFK  | done   |
| 03  | [Codebase Cleanup](./03-codebase-cleanup.md)                          | AFK  | done   |

## Problem Statement

Ryot's rewritten backend (`apps/app-backend`) wants to become a domain-agnostic kernel whose
media- and fitness-specific behavior lives in plugins. Today it cannot: schema definitions
(entity, event, relationship, signal schemas, tracker definitions, and builtin saved views)
are stored as rows in Postgres, seeded per-user and flagged with `isBuiltin`. This conflates
two different things — **definitions** (which the owner authors and ships) and **state**
(which belongs to users) — and it forces every data row to reference its schema through a
foreign key to a definition row. As long as definitions live in the database, every new
module built on top of the schema tables deepens the coupling and raises the cost of the
eventual plugin system. It is also the most invasive storage and contract change in the whole
rewrite, so doing it first is what makes the later phases tractable.

The full rationale, and why this phase comes first, is in
`docs/plans/plugin-system/00-overview.md` (see "Sequencing rationale") and Decisions 4, 5, and
6 of its decision record.

## Solution

Move schema **definitions** out of Postgres into an in-memory, slug-keyed registry that is
fed directly from the existing `modules/builtins/` code, and change every data row to
reference its schema by **slug string with no foreign key**. Delete all the machinery that
existed only to store definitions in the database — the definition tables, the per-user
materialization of builtin trackers and saved views, the `isBuiltin` flags, and the user-facing
CRUD for creating custom schemas (which Decision 1 removes outright). What remains per-user
becomes thin state-override tables layered over the registry defaults at read time.

Crucially, this phase is **decoupled from the plugin format itself**: there is no manifest,
loader, or package restructuring here (that is Phase 2). The registry is fed straight from the
current builtins code, and sandbox scripts plus automation-rule rows keep being DB-seeded —
only their schema _references_ change from FK ids to slugs. That keeps this phase to exactly
one moving part.

The complete solution — what the registry contains, which tables are dropped versus converted,
how each consumer is repointed, and how trackers/saved-views split into definition-plus-state —
is specified in `docs/plans/plugin-system/01-phase-1-schema-registry.md`. Do not re-derive it.

## User Stories

Actors: **owner** (writes and ships the builtin definitions), **kernel** (the
domain-agnostic backend), **plugin developer** (future author, whose path this phase clears),
**end user** (uses trackers and saved views), **sandbox script** (provider/automation code
calling host functions), **API client** (`app-client` and the browser extension), and
**implementing agent**.

1. As the owner, I want schema definitions to live in code rather than database rows, so that
   I author and ship them the way I ship the rest of the backend instead of seeding them.
2. As the kernel, I want to serve every schema definition from a single in-memory, slug-keyed
   registry, so that lookups are synchronous reads with no join to a definition table.
3. As the kernel, I want the registry to sit behind a single immutable snapshot reference, so
   that Phase 2 can swap the snapshot atomically without reworking the read path.
4. As the kernel, I want to fail fast at startup on duplicate slugs, `/` in a slug, or a
   dangling tracker→schema / view→tracker / relationship→entity-schema reference, so that a
   broken definition set never reaches serving traffic.
5. As a data row (entity, event, relationship, signal), I want to reference my schema by slug
   with no foreign key, so that definitions can move to code without breaking referential
   reads.
6. As the kernel, I want referential integrity for definitions enforced in application code
   rather than by database FKs, so that dropping the definition tables is safe.
7. As the owner, I want the `AppSchema` property-schema format kept as-is and validated by the
   existing property-schema runtime, so that the query engine and schema-driven frontend keep
   their introspectable property metadata (Decision 6).
8. As a write path, I want to validate incoming properties against the registry instead of
   joining schema tables, so that writes no longer depend on definition rows.
9. As the query engine, I want stored slugs to remove the slug→row-id resolution step, so that
   read semantics are preserved while the resolution layer disappears.
10. As a sandbox script, I want `getEntitySchemas` and `listEventSchemas` to return the same
    response shapes as before, now sourced from the registry, so that provider and automation
    scripts keep working unchanged.
11. As an end user, I want builtin trackers and saved views to come from the registry rather
    than rows copied into my account, so that they exist without per-user materialization.
12. As an end user, I want my per-user deviations (disabling or reordering a tracker or a
    builtin saved view) stored as thin lazy state rows over the registry defaults, so that I
    still get personalization without owning a full definition copy.
13. As an end user, I want my own created saved views to keep working (now keyed by
    `trackerSlug`), so that user-authored views survive this change.
14. As the kernel, I want the no-code custom-schema creation surface removed entirely
    (Decision 1), so that the only path to new schemas becomes the future plugin system.
15. As an API client, I want a small read-only definitions surface to list entity schemas
    (with their event schemas), relationship schemas, and trackers by slug, so that
    schema-driven UI has what it needs even though the old CRUD groups are gone.
16. As the kernel, I want the known dependency-gradient violations dissolved (the
    entity-schemas and auth services importing tracker services), so that deleting user-schema
    CRUD also cleans up the module gradient.
17. As `user-bootstrap`, I want to stop materializing builtin trackers and saved views per
    user while still running `ensureDefaultRules`, so that bootstrap only creates genuine
    per-user state.
18. As `legacy-bootstrap`, I want my schema-table reads/writes converted to registry lookups
    and slug columns, so that the legacy adoption path keeps its preserved e2e behavior.
19. As the owner, I want no `isBuiltin` column left on any surviving table (except
    `sandbox_script` and `automation_rule`, which die in Phase 2), so that the
    definition/state conflation is fully removed.
20. As the implementing agent, I want to regenerate the single initial drizzle migration and
    its `meta/` snapshot rather than author ALTERs, so that the schema change stays clean given
    nothing is deployed.
21. As the implementing agent, I want the e2e suite migrated in lockstep — CRUD suites for
    removed surfaces deleted, id-based fixtures re-plumbed to slugs, assertions preserved — so
    that "suite green" remains the done criterion (Decision 16, cross-phase invariant 2).
22. As a maintainer, I want each touched `AGENTS.md`/`AGENTS.md`/`README.md` updated where
    conventions changed, so that documentation follows the code (cross-phase invariant 7).
23. As the owner, I want the branch to stay shippable at the end of the phase — backend
    `check` and unit tests, the e2e suite (minus deleted files), and `app-client` check all
    green — so that Phase 2 starts from a working base (cross-phase invariant 1).

## Implementation Decisions

Every technical decision for this phase is already made and written down. Rather than restate
them (and risk drift), this PRD points to the exact sections that own them:

- **The registry** — content by slug, snapshot/volatile-reference design, colocated
  validation helpers, fail-fast startup validation, and which builtin files feed it: plan §1
  ("Build the registry"). Suggested location and exact name are `[IMPLEMENTER-DECIDES]`.
- **Storage changes** — the exact tables dropped, the FK-id→slug column conversions with the
  indexes to preserve, the `event`-keeps-local-slug `[RECOMMENDED]` choice and its
  denormalization escape hatch, the uniqueness triplets that encode product behavior, and the
  regenerate-the-migration instruction: plan §2.
- **Consumer conversion** — the mechanical grep to find them and the near-exhaustive list
  (write paths, query engine, sandbox host functions, the deleted schema/tracker modules,
  `user-bootstrap`, `legacy-bootstrap`, `builtins/seed.ts`, relations): plan §3.
- **Trackers and saved views** — the definition-vs-state split, the `[RECOMMENDED]`
  `tracker_state` and `saved_view_state` lazy-row tables, the shrunk `trackers` contract
  surface, and the read-time merge: plan §4.
- **Contract deletions** — which groups are deleted versus shrunk, the new `[RECOMMENDED]`
  read-only `definitions` group, the `test-support` and DTO sweeps for `…SchemaId`: plan §5.
- **Cross-cutting rules** — kernel purity (no media/fitness strings, branches, or imports;
  Decision 2), slug namespacing with `/` forbidden (Decision 18), and the module conventions
  in `apps/app-backend/AGENTS.md`: overview decision record and cross-phase invariants.

Follow the plan markers when a section leaves room: `[DECIDED]` is fixed, `[RECOMMENDED]` is
the default (deviate only with concrete evidence, and record it in the plan), and
`[IMPLEMENTER-DECIDES]` is yours to settle and record. If implementation uncovers evidence
that a `[DECIDED]` item is wrong, **stop and surface it** rather than silently deviating.

## Testing Decisions

- **What a good test is here:** the e2e suite (`tests/`) is the behavioral spec (Decision 16).
  Migration is plumbing-only — fixtures, endpoints, and ids→slugs change, but **what is
  asserted stays the same**. A behavioral change requires explicit owner sign-off, not a quiet
  test edit (cross-phase invariant 2). Test app-owned behavior and branching, not library
  behavior, per `AGENTS.md`.
- **Suites to delete:** the tracker CRUD suites and the user-created-schema tests under
  `entity-schemas/`, `event-schemas/`, `relationship-schemas/` — but keep the provider
  search/import tests that live in `entity-schemas/` (they test surviving behavior; rename the
  file if its name becomes misleading). Details in plan §6.
- **Suites to re-plumb (assertions preserved):** the 15 files using
  `getBuiltinEntitySchemaId`/`linkToEntitySchemaId` switch to slugs; `fixtures/entity-schemas.ts`
  and `fixtures/trackers.ts` are rewritten or folded; `seed-script.ts` is touched only if it
  references removed surfaces. Prior art and conventions are in `tests/AGENTS.md` (update it
  where conventions change).
- **New unit test required:** registry startup validation must fail fast on a deliberately
  broken definition (done criterion 3). This is the one net-new test the phase mandates.
- **Behavior spot-checks that must stay green** (done criterion 4): media lifecycle
  (progress → auto-complete), provider search/import, the 21-file query-engine suite
  (untouched, already slug-based), and the legacy-bootstrap suite.
- **The gate** (done criterion 2, cross-phase invariant 1): `bun turbo --filter=@ryot/app-backend check`
  plus backend unit tests (`cd apps/app-backend && bun run test`), the e2e suite
  (`cd tests && bun run test`, minus deleted files), and the `app-client` check all pass.
  Run e2e and backend tests from their own app directories per `AGENTS.md`.

## Out of Scope

- Anything in Phase 2+: plugin manifest, ingestion, loader, hot-load, package restructuring,
  builtins becoming plugin packages, and the eventual deletion of `automation_rule`,
  `sandbox_script`'s and `automation_rule`'s `isBuiltin` flags, `entity_schema_sandbox_script`,
  and the per-user notification-subscription storage move (`00-overview.md` phase table;
  plan §1 "Explicitly not in this phase").
- Sandbox scripts and automation-rule rows continue to be DB-seeded in this phase; only their
  schema references change to slugs.
- The five native domain modules keep working, repointed at the registry — they are not moved
  into plugins until Phase 3.
- The YAGNI non-goals through Phase 4 (no plugin-dependency resolution, marketplace/signing,
  user-level installation, or speculative Phase 5 manifest fields; cross-phase invariant 5).
- `apps/app-client-backup` (retained as a reference; deletion explicitly deferred) and the legacy
  `apps/backend`/`apps/frontend` system (untouched by this plan; Decision 17).

## Further Notes

- **No deployment constraints.** All work is local on the `ultra-rewrite` branch; there is no
  CI, `apps/app-backend` is not deployed, dev databases are wipeable, and the single initial
  drizzle migration may be regenerated freely (`00-overview.md` status line and §2).
- **The plans are living documents during implementation.** Record `[RECOMMENDED]` deviations
  and `[IMPLEMENTER-DECIDES]` choices by editing the relevant plan file, not this PRD.
- **Pattern discovery before writing.** Per `AGENTS.md`, launch an `explore` subagent to find
  existing patterns to replicate (e.g. the property-schema runtime, existing module/service
  structure) before writing new code; `explore` is for discovery only.
- **A mandatory final cleanup task** (following the `codebase-cleanup` skill) will be appended
  when this PRD is broken into tasks — a final pass over the touched files and directly
  affected modules to remove dead, duplicated, or leftover code.
