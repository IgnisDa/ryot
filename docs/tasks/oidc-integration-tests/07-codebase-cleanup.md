# Codebase Cleanup

**Parent Plan:** [OIDC Integration Tests](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors.

Files and modules directly touched by this plan:

- `apps/app-backend/src/lib/auth/instance.ts` (hook added)
- `apps/app-backend/src/modules/authentication/routes.ts` (bootstrap call removed)
- `apps/app-backend/src/modules/authentication/bootstrap/sign-up.ts` (no changes expected, but verify)
- `tests/src/tests/auth.test.ts` (new)
- `tests/src/tests/auth-oidc.test.ts` (new)
- `tests/src/fixtures/auth-oidc.ts` (new)
- `tests/src/fixtures/auth.ts` (verify no dead code after task 02 additions)

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules
- [ ] Any removals or simplifications are reflected in the changed code before the plan is considered complete
