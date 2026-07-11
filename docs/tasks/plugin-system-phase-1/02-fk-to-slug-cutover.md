# FK-to-Slug Storage and Consumer Cutover

**Parent Plan:** [Plugin System — Phase 1: Schema Registry](./README.md)

**Type:** AFK

**Status:** done

## Required reading (do this first)

Before writing any code, read both authoritative spec files in full:

1. `docs/plans/plugin-system/00-overview.md` — the vision, the marker rules, the decision
   record (especially Decisions 1, 2, 4, 5, 6, 16, 17, 18), the current-state map (storage,
   consumers, contract, e2e), and the cross-phase invariants.
2. `docs/plans/plugin-system/01-phase-1-schema-registry.md` — the Phase 1 spec. This task
   implements **§2, §3, §4, §5, and §6** (everything except §1, which is task 01).

Also read the parent [README.md](./README.md) for the framing, user stories, and testing
decisions. This task **depends on task 01** (the registry must exist first).

## What to build

The single **atomic cutover** that moves schema definitions out of Postgres and repoints every
consumer at the registry built in task 01. This is intentionally one task, not several: the
column conversions (FK id -> slug text) force every reader and writer of those columns to
change together, the deleted schema/tracker CRUD must drop in lockstep with its contract
groups (so `app-client` still compiles), and the e2e suite must go green in the same step.
Splitting it would produce pieces that only compile as part of the whole. Do **not**
fake-split it.

Implement exactly what the plan specifies across these sections — reference them, do not
re-derive them:

- **§2 Storage:** drop the definition tables (`entity_schema`, `event_schema`,
  `relationship_schema`, `signal_schema`, `tracker_entity_schema`); convert the FK-id columns
  to `…Slug` text per the §2 conversion table, preserving equivalent indexes and the exact
  `entity` global-vs-user uniqueness triplets (including the NULLS-NOT-DISTINCT workaround
  pair). Follow the `[RECOMMENDED]` "event keeps only the local slug" choice, using the query
  plans to decide whether the `entitySchemaSlug` denormalization is needed, and record the
  outcome in the plan. Regenerate the single `src/drizzle/0000_*.sql` migration and `meta/`
  snapshot rather than authoring ALTERs.
- **§3 Consumers:** convert every consumer named in §3 — write paths (validate via registry,
  store slugs), query engine (slug->row-id resolution disappears, read semantics preserved),
  sandbox host functions (`getEntitySchema`/`listEventSchemas` re-read from the registry,
  response shapes kept identical where possible), the deleted `entity-schemas`/`event-schemas`/
  `relationship-schemas`/`trackers` CRUD modules (dissolving the known gradient violations),
  `user-bootstrap` (stop materializing builtins per user; keep `ensureDefaultRules`),
  `legacy-bootstrap`, `builtins/seed.ts` (schema/tracker/view seeding deleted; script and
  automation-rule seeding stay, slug-keyed), and `tables/relations.ts`.
- **§4 Trackers/saved views:** replace `tracker` with the `[RECOMMENDED]` thin `tracker_state`
  table and add the `[RECOMMENDED]` `saved_view_state` table; serve definitions from the
  registry merged at read time with per-user state; shrink `trackers` to list + update-state;
  retire the user-created default-view workflow.
- **§5 Contract:** delete the `entity-schemas`/`event-schemas`/`relationship-schemas` groups;
  shrink `trackers` to the §4 state surface; add the `[RECOMMENDED]` read-only `definitions`
  group (schema DTOs minus ids/`isBuiltin`, keyed by slug); update `test-support`; sweep
  `@ryot/contract` DTOs so schema references are slugs.
- **§6 E2e:** delete the CRUD/user-created-schema suites named in §6 (keeping surviving
  provider search/import tests), re-plumb the id-based fixtures to slugs with **assertions
  preserved**, and update `tests/AGENTS.md` where conventions change.

Per cross-phase invariant 7, update each touched `AGENTS.md`/`AGENTS.md`/`README.md` where
conventions changed (facts move, they do not duplicate). Per `AGENTS.md`, launch an `explore`
subagent to find existing patterns before writing; record `[RECOMMENDED]` deviations and
`[IMPLEMENTER-DECIDES]` choices back into the plan file. If implementation shows a `[DECIDED]`
item is wrong, **stop and surface it** rather than silently deviating.

## Acceptance criteria

Derived from the Phase 1 done criteria (§"Done criteria") and the cross-phase gate:

- [x] Grep proof covers imports, identifiers, and generated raw SQL: no post-Drizzle app-backend
      source references the dropped tables or the `…SchemaId` columns, except deliberately kept
      migration/bootstrap handling.
- [x] All gates pass: `bun turbo --filter=@ryot/app-backend check` + backend unit tests
      (`cd apps/app-backend && bun run test`), the e2e suite (`cd tests && bun run test`,
      minus the files deleted in §6), and the `app-client` check (done criterion 2,
      cross-phase invariant 1).
- [x] Behavior spot-checks stay green in e2e: media lifecycle (progress -> auto-complete),
      provider search/import, and the query-engine suite (untouched and green). Generated legacy
      SQL has regression coverage against dropped definition-table references; full legacy
      behavior is validated manually against both documented dumps before release.
- [x] No `isBuiltin` column remains on any surviving table except `sandbox_script` and
      `automation_rule` (both die in Phase 2); `signal_schema`'s flag is gone with its table
      (done criterion 5).
- [x] e2e migration preserves what is asserted; only plumbing (fixtures, endpoints, ids->slugs)
      changed (cross-phase invariant 2).
- [x] The initial drizzle migration and `meta/` snapshot are regenerated (not ALTERed), and
      the `event` local-slug / denormalization outcome is recorded in the plan (§2).
- [x] `[RECOMMENDED]` deviations and `[IMPLEMENTER-DECIDES]` choices are recorded in the Phase 1
      plan file; touched `AGENTS.md`/`AGENTS.md`/`README.md` files are updated.

## User stories addressed

Reference by number from the parent PRD:

- User stories 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
