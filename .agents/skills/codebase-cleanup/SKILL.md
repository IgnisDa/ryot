---
name: codebase-cleanup
description: Review changed code and remove duplicate, dead, redundant, speculative, or unnecessary implementation leftovers before considering the work complete. Use when the user asks for cleanup, polish, deduplication, refactoring out useless code, or a final pass after feature work.
---

# Codebase Cleanup

Use this skill for the final cleanup pass after implementation work, or whenever the user asks you to remove useless code.

## Scope

Clean up touched files and directly affected modules. Do not turn this into an unrelated opportunistic refactor.

## Goals

Remove anything that is no longer needed or that was introduced only to unblock implementation.

Specifically look for:

- Duplicate code, logic, utilities, or helper functions that can be consolidated
- Duplicate or redundant types and interfaces
- Rename-only or passthrough type aliases; prefer importing canonical types directly from the module that defines them
- Needless exported or re-exported types that merely proxy another module's types
- Parallel hand-written types that duplicate an existing source-of-truth shape instead of deriving from it
- Shallow wrapper modules, one-line helpers, barrel exports, or rename-only helpers that only forward another symbol
- Unnecessary public API surface: exported types, functions, constants, or helpers that do not need to be shared
- Duplicate, overlapping, or value-free tests
- Dead code: unreachable branches, unused variables, unused imports, unused exports
- Leftover TODO / FIXME comments that were resolved during implementation
- Temporary compatibility layers or dual code paths left behind after the new path lands
- Stale fixtures, mocks, snapshots, docs, scripts, feature flags, or config/env knobs introduced only for the implementation
- Temporary or scaffold code introduced to unblock an earlier step
- YAGNI violations: abstractions or configuration options added speculatively but never actually used

## Rules

- Prefer canonical imports over local aliases or passthrough exports
- Prefer derived types over parallel hand-written shapes
- Do not keep exports public unless another real module consumes them
- Do not keep compatibility layers after the migration is complete unless there is a concrete requirement
- Do not preserve scaffolding just because it was useful during implementation

## Checklist

- [ ] No duplicate functions, utilities, or logic blocks remain in changed code
- [ ] No duplicate or redundant types / interfaces remain
- [ ] No rename-only or passthrough type aliases remain
- [ ] No unnecessary exported or re-exported types remain
- [ ] No parallel hand-written types remain where a canonical or derived type already exists
- [ ] No shallow wrapper modules, one-line helpers, barrel exports, or rename-only helpers remain when they only forward an existing symbol
- [ ] No unnecessary public API surface remains; only genuinely consumed symbols are exported
- [ ] No duplicate, overlapping, or value-free tests remain
- [ ] No unused imports, variables, or exports remain in changed files
- [ ] No unreachable or dead code branches remain in changed code
- [ ] No resolved TODO / FIXME comments remain
- [ ] No temporary compatibility layers or dual code paths remain unless explicitly required
- [ ] No stale fixtures, mocks, snapshots, docs, scripts, feature flags, or config/env knobs remain from the implementation
- [ ] No temporary scaffold code remains from earlier implementation steps
- [ ] No speculative abstractions or config options remain unless they are actually needed now

## Output

When you apply this skill during a task, describe the cleanup work in terms of the real code removed or simplified. Keep the explanation concrete and scoped.
