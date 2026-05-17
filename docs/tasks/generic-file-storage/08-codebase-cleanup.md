# Codebase Cleanup

**Parent Plan:** [Generic File Storage](./README.md)

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete

## Cleanup Applied

- Removed unused Redis `claim`, `getdel`, and direct `zadd` helpers and their test scaffolding.
- Removed the unused local-storage configuration flag and an unnecessary upload-service export.
- Reused the canonical upload provider, kind, and managed-asset schemas for persisted intent metadata.
- Removed unreferenced import-file and ZIP extraction helpers and the orphaned `unzipit` dependency.
- Removed duplicate backend-level parser dependencies; `@ryot/sandbox-sdk` remains their owner.

## Verification

- `bun turbo --filter=@ryot/app-backend check --force` passed.
- `bun turbo --filter=@ryot/app-backend build --force` passed.
- `bun turbo --filter=@ryot/app-backend test --force` passed.
- `bun turbo prune @ryot/app-client @ryot/app-backend --docker` passed; the pruned graph includes `@ryot/sandbox-sdk` and its parser dependencies.
- The affected e2e files passed separately with `--force`: kernel uploads, kernel imports, media imports, and fitness imports.
- `git diff --check` passed.
- The legacy backup client and unrelated frontend storage code were retained because they are outside the cleanup changeset; the backup client source remains untouched.
