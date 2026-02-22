# Ownership-Based E2E Test Tree

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Reorganize the e2e suite by final architectural ownership. Read the overview, Phase 4 plan, parent
PRD, and this task first.

Move generic infrastructure and behavior suites under kernel ownership, media behavior under the
media plugin tree, and fitness behavior under the fitness plugin tree. Split mixed import,
integration, query, definitions, event, saved-view, system, or smoke files only where ownership
requires it. Preserve test bodies, intent, workloads, and assertions; update imports/config/docs as
pure plumbing.

## Acceptance criteria

- [ ] Every e2e file is classified as kernel, media plugin, or fitness plugin by behavior rather than its old directory name
- [ ] Mixed files are split without changing assertion meaning or silently dropping cases
- [ ] Media imports, integrations, monitoring, recipes, and crons live under media ownership
- [ ] Fitness imports, workouts, templates, measurements, and exercises live under fitness ownership
- [ ] Generic loader, sandbox, auth, persistence, collection, and query semantics live under kernel ownership
- [ ] Test discovery, aliases, lint rules, targeted commands, and operational/live opt-in gates still work
- [ ] Searches show no suites left in obsolete top-level ownership directories
- [ ] Test counts and assertions are reconciled before/after moves
- [ ] The full standard e2e suite passes after reorganization

## User stories addressed

- User story 41
- User story 42
