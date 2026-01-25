---
name: codebase-cleanup
description: Reviews code changed in the current task for cleanup, polish, deduplication, and final-pass removal of verified dead, redundant, speculative, or temporary leftovers. Use when requested or after substantive feature or refactor work.
---

# Codebase Cleanup

Clean up only code changed for the current task and directly affected call sites. Preserve unrelated work. Keep cleanup behavior-preserving unless the user explicitly requests behavior changes.

## Guardrails

- Treat every item below as a candidate, not an automatic deletion
- Remove code only after verifying relevant callers, package exports, scripts, configuration, code generation, runtime registration, migrations, persisted data, and external consumers
- Do not infer that an exported symbol is unused from static in-repository references alone
- Preserve wrappers and boundaries that provide domain meaning, adaptation, instrumentation, test seams, or a stable public API
- Consolidate repetition only when it represents the same invariant and should evolve together; leave coincidental similarity alone
- Do not hand-edit generated artifacts; update their source and regenerate them
- If evidence is inconclusive, leave the code in place and report the candidate
- If no justified cleanup exists, make no changes

## Candidates

- Dead code: unreachable branches and verified-unused imports, variables, functions, exports, modules, files, dependencies, scripts, or assets
- Parallel hand-written types that duplicate a schema or canonical type; derive or import the source-of-truth type instead
- Aliases, wrappers, one-line helpers, re-exports, or barrels that add no semantic value or boundary
- Repeated logic, validation, normalization, defaults, conversions, fallback paths, or error handling that express the same rule
- Unnecessary casts, non-null assertions, lint disables, type suppressions, coverage ignores, or other bypasses whose underlying need is gone
- Tests that assert identical behavior or merely prove library or TypeScript behavior; preserve distinct branches, contracts, regressions, and diagnostic value
- Stale comments, commented-out code, orphaned notes, resolved TODO or FIXME comments, and documentation that no longer describes the code; retain rationale and non-obvious invariants
- Temporary logging, debugger statements, instrumentation, diagnostics, assertions, test `.only`, resolved `.skip`, sleeps, retries, or enlarged timeouts
- Completed migration scaffolding, compatibility paths, feature flags, fallback implementations, or rollback code after verifying rollout and data obligations are complete
- Stale fixtures, mocks, snapshots, configuration knobs, and temporary implementation scaffolding
- YAGNI violations: speculative abstractions, extension points, configuration, or indirection without a current consumer

## Process

1. Inspect the current-task diff and directly affected call sites.
2. Identify candidates and verify actual use, ownership, runtime entry points, and API or migration obligations.
3. Make the smallest deletion or simplification that preserves behavior. Avoid broad renames, formatting churn, or adjacent redesign.
4. Run repository-prescribed formatting, checks, and focused tests for affected packages.
5. Inspect the final diff for behavior changes, lost coverage, and unrelated churn.

## Output

Report concrete code removed or simplified, verification commands and results, and candidates retained because evidence was insufficient. If nothing warranted cleanup, say so explicitly.
