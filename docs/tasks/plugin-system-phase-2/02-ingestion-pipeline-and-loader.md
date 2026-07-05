# Ingestion Pipeline, Storage, and Hot-Capable Loader

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** done

## Before you start

Read `docs/plans/plugin-system/00-overview.md` and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` in full before writing any
code. They are the authoritative spec; this task file only frames the slice. Honor the plan
markers (`[DECIDED]`/`[RECOMMENDED]`/`[IMPLEMENTER-DECIDES]`) as described in the parent PRD.
Per `AGENTS.md`, launch an `explore` subagent first — the Phase 1 registry and its snapshot
reference, the `tracker_state` state-split pattern, the sandbox-runtime host-call bridge and
compiled-module loading (`apps/app-backend/src/lib/infrastructure/sandbox-runtime/`), and the
existing Redis usage. Depends on task 01 (manifest contract + compiler extension).

## What to build

The ingestion pipeline and hot-capable loader as additive kernel infrastructure, exercised by
tests against a **fixture** plugin — deliberately **not yet** wired as the boot definition
source (SeedService keeps feeding the registry until task 03). This is the "infrastructure
lands before its consumers" slice.

`ingestPlugin(source) → NormalizedPlugin`, per plan §4:

1. **Validate** the manifest (Effect Schema decode + referential checks: every binding
   references a declared script/schema; slugs contain no `/`; no collisions with already-loaded
   plugins or kernel definitions).
2. **Compile** all scripts via the task-01 compiler; fail the whole ingestion on any
   diagnostic (all-or-nothing).
3. **Content-address**: compute `sourceHash` (manifest + all source files) and per-script
   `compiledHash`; record the `sourceHash → compiledHash[]` mapping (compiled bytes are
   identity — Decision 12).
4. **Persist**: new `plugin` table `(slug, version, manifest jsonb, sourceHash, ingestedAt,
status)`; reuse `sandbox_script` rows for compiled modules with new `pluginSlug` and
   `contentHash` columns, immutable per hash (new version ⇒ new row), superseded rows retained
   while referenced (GC is out of scope). Add these columns additively; the `isBuiltin` drop
   and SeedService deletion happen in task 03, so builtin script rows keep working here
   (regenerate the single drizzle migration rather than authoring ALTERs — dev DB is wipeable).
5. **Load**: build a new registry snapshot (Phase 1 registry + plugin definitions + bindings)
   and swap it atomically; publish a Redis invalidation message so other instances rebuild from
   the DB.

Also build the **additive-only schema-evolution differ** used on the hot path: when an
ingestion replaces an existing plugin version, diff old vs new entity/event/relationship/signal
property schemas — additive changes (new schemas, new optional properties, widened enums) pass;
breaking changes (removed schemas/properties, type changes, new required properties, narrowed
enums) are rejected with a structured error.

`[IMPLEMENTER-DECIDES]`: whether to keep build-time precompilation (the `generated-sandbox`
cache) as a boot short-circuit or accept compile-on-first-boot — measure boot time before
choosing, and record the choice in the plan. The boot short-circuit path (skip compile when
stored `sourceHash` matches) is built here regardless; wiring it to actual boot is task 03.

Full spec: plan §4 (pipeline, storage, boot short-circuit, evolution diff) and §7 (the unit
tests below). Do not restate or re-derive it.

## Acceptance criteria

- [x] `ingestPlugin` validates, compiles, content-addresses, persists, and loads a fixture
      plugin into a test registry snapshot with an atomic swap (plan §4)
- [x] Ingestion unit tests cover each failure mode: manifest validation failure, compile
      diagnostic, slug collision, dangling binding, and `/` in a slug (plan §7)
- [x] Loader unit tests cover atomic swap under concurrent reads and boot short-circuit on a
      matching `sourceHash` (plan §7)
- [x] The schema-evolution differ accepts additive changes and rejects each breaking category
      with a structured error, under unit test (plan §4, §7)
- [x] The Redis invalidation message → snapshot-rebuild path is unit-tested (a two-backend e2e
      is explicitly out of scope, plan §7 `[RECOMMENDED]`)
- [x] `plugin` table and additive `sandbox_script` `pluginSlug`/`contentHash` columns exist via
      a regenerated migration; existing builtin seeding still works and the full suite stays
      green (cross-phase invariant 1)
- [x] The boot definition source is unchanged (SeedService still runs); the loader is exercised
      only by tests in this slice
- [x] `[IMPLEMENTER-DECIDES]` precompilation-cache choice is measured and recorded in the plan

## User stories addressed

- User story 9
- User story 10
- User story 11
- User story 12
- User story 13
- User story 14
- User story 18
- User story 19
