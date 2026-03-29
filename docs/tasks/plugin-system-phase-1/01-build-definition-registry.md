# Build the Definition Registry

**Parent Plan:** [Plugin System — Phase 1: Schema Registry](./README.md)

**Type:** AFK

**Status:** todo

## Required reading (do this first)

Before writing any code, read both authoritative spec files in full:

1. `docs/plans/plugin-system/00-overview.md` — the vision, the `[DECIDED]`/`[RECOMMENDED]`/
   `[IMPLEMENTER-DECIDES]` marker rules, the decision record (especially Decisions 4, 5, 6,
   and 18), the current-state map, and the cross-phase invariants.
2. `docs/plans/plugin-system/01-phase-1-schema-registry.md` — the Phase 1 spec. This task
   implements **§1 ("Build the registry")** only.

Also read the parent [README.md](./README.md) for the framing, user stories, and testing
decisions.

## What to build

A new in-memory, slug-keyed **definition registry** kernel service, fed directly from the
existing `modules/builtins/` definition sources, serving entity schemas (with their scoped
event schemas), relationship schemas, signal schemas, tracker definitions, and builtin saved
views. This slice is **purely additive**: it introduces the registry and its startup
validation alongside the current DB-backed definitions without removing or repointing any
consumer yet. That is deliberate — it lands the infrastructure that every later consumer
depends on, and because nothing is dropped or rewired, the branch compiles and all gates stay
green.

Implement exactly what plan §1 specifies — do not restate or re-derive it here:

- Registry content by slug (entity/event/relationship/signal schemas, tracker definitions,
  builtin saved views), fed from the existing builtin files named in §1. Do **not** reshape
  those files beyond what the registry needs (they are restructured into plugin packages in
  Phase 2).
- Synchronous lookups from an immutable snapshot behind a single volatile reference, built so
  Phase 2 can swap the snapshot atomically.
- Colocated validation helpers (`validateEntityProperties(slug, props)` etc.) delegating to
  the existing property-schema runtime.
- Fail-fast startup validation on duplicate slugs, `/` in a slug, and dangling
  tracker→schema / view→tracker / relationship→entity-schema references.

Exact name and location are `[IMPLEMENTER-DECIDES]` (§1 suggests
`apps/app-backend/src/modules/definition-registry/`, generic end of the module gradient);
record your choice in the plan file. Per `AGENTS.md`, launch an `explore` subagent to find the
property-schema runtime and existing service/module patterns to replicate before writing.

## Acceptance criteria

Derived from Phase 1 done criterion 3 and the cross-phase gate (invariant 1):

- [ ] The registry serves all definition kinds in §1 by slug from an immutable snapshot behind
      a single volatile reference, fed from the existing `modules/builtins/` sources without
      reshaping them.
- [ ] Colocated validation helpers delegate to the existing property-schema runtime.
- [ ] Registry startup validation fails fast on a deliberately broken definition (duplicate
      slug, `/` in a slug, or a dangling tracker/view/relationship reference), covered by a
      new unit test (done criterion 3).
- [ ] The slice is additive: no definition tables, columns, contract groups, or consumers are
      changed in this task.
- [ ] Gate stays green: `bun turbo --filter=@ryot/app-backend check`, backend unit tests
      (`cd apps/app-backend && bun run test`), the e2e suite (`cd tests && bun run test`), and
      the `app-client` check all pass.
- [ ] Any `[RECOMMENDED]` deviation or `[IMPLEMENTER-DECIDES]` choice (name/location, etc.) is
      recorded in the Phase 1 plan file.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 3
- User story 4
- User story 6 (registry-side: integrity enforced in application code)
- User story 7
