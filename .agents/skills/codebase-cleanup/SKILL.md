---
name: codebase-cleanup
description: Review changed code and remove duplicate, dead, redundant, speculative, or unnecessary implementation leftovers before considering the work complete. Use when the user asks for cleanup, polish, deduplication, refactoring out useless code, or a final pass after feature work.
---

# Codebase Cleanup

Clean up touched files and directly affected modules only. Do not turn this into an unrelated refactor.

## What to Remove

- Duplicate code, logic, utilities, or helpers — consolidate instead
- Duplicate or redundant types and interfaces
- Rename-only or passthrough type aliases; prefer importing the canonical type directly
- Needless re-exports that merely proxy another module's symbols
- Parallel hand-written types that duplicate a source-of-truth shape — derive instead
- Shallow wrappers, one-line helpers, barrel exports, or rename-only forwards
- Unnecessarily exported symbols that no other module consumes
- Duplicate, overlapping, or value-free tests
- Dead code: unreachable branches, unused variables, unused imports, unused exports
- Stray comments: orphaned notes, commented-out code, stale docs, leftover explanations
- Resolved TODO / FIXME comments
- Temporary compatibility layers or dual code paths left after the new path lands
- Stale fixtures, mocks, snapshots, scripts, feature flags, or config knobs introduced only for implementation
- Temporary scaffold code from earlier steps
- YAGNI violations: speculative abstractions or config options never actually used

## Principles

- Prefer canonical imports over local aliases or passthrough exports
- Prefer derived types over parallel hand-written shapes
- Remove, don't preserve: compatibility layers after migration, scaffolding after use, exports nothing consumes

## Output

Describe cleanup work in terms of the real code removed or simplified. Keep it concrete and scoped.
