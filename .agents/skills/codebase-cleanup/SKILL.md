---
name: codebase-cleanup
description: Removes leftovers of the current work - obsolete, dead, duplicated, and temporary code, comments, tests, and docs. Use only when the user asks, or once in the main session after a whole task is complete. Never load it in subagents, mechanical agents, or read-only or planning work.
---

# Codebase Cleanup

Run this pass yourself in the main session; do not delegate it. The root `AGENTS.md` rules are the standard. This pass finds and removes what violates them or outlived its purpose.

## Scope

- State the base commit before starting: the commit before the task, or the plan's commits as marked by their messages.
- Cover `git diff <base>`, untracked files the work created, and code anywhere in the repository that this work made obsolete. Leave unrelated work alone.

## Rules

- This pass must remove more lines than it adds. Do not add comments, suppressions, casts, tests, abstractions, or documentation.
- Do not reverse a decision the user or the approved plan made, and do not revert the user's formatting.
- Start only after other agents stop writing, and re-read each file before editing it.
- Before deleting, check callers, runtime registrations, manifests, compiler import allowlists, generated outputs, and e2e usage. Leave a candidate that is still used and report it.
- Update generated files by regenerating them from their source.

## Candidates

- Compatibility paths, bridges, fallbacks, adapters, version-labelled names, and old code paths the work replaced.
- Comments that restate code, narrate history ("now", "previously", "moved from"), or refer to tasks or plans, including task-tagged TODOs.
- Lint suppressions, casts, and non-null assertions that a real fix removes.
- Re-exports and aliases of another module's symbols, and exports used only inside their own module.
- Hand-written types that mirror a schema, recipe result, or contract type.
- Consumers that parse `RowItem` values instead of using recipe decoders.
- Duplicated helpers, predicates, validation, and test fixtures that express the same rule.
- Functions, endpoints, repository methods, files, and package dependencies left unused.
- Test-only accessors on production code, mocks and spies, tests of old behavior, redundant negative cases, and schema checks.
- Temporary logging, diagnostics, `.only` or `.skip`, sleeps, enlarged timeouts, scratch files, and benchmark output.
- Documentation and `AGENTS.md` text that names removed or renamed code or records history.

## Process

1. Establish the base commit and the obsolete code outside the diff.
2. List added comments, suppressions, casts, non-null assertions, re-exports, and TODOs mechanically, then review each hit and the rest of the diff:

   ```bash
   { git diff <base> -U0; git ls-files -o --exclude-standard | while read -r f; do git diff --no-index -U0 /dev/null "$f"; done; } |
     grep -E '^\+\+\+ |^\+(\s*(//|/\*|\*\s)|.*(oxlint-disable|@ts-|[^A-Za-z_]as [A-Za-z{(]|[A-Za-z0-9_)\]]!(\.|\)|;|,|\[|$)|export (type )?(\*|\{[^}]*\} from)|TODO))'
   ```

3. Verify each candidate, then make the smallest removal or simplification.
4. Run formatting, the affected e2e files, and the done commands from the root `AGENTS.md`.
5. Check the final diff for behavior changes, lost coverage, and net growth.

## Report

Keep it short:

- Removed or simplified, by file.
- Kept, with a one-line reason each.
- Net lines changed, and any remaining suppressions or casts.
- Commands run and their results.
