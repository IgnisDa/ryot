# Remove Legacy Contract Artifacts

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Remove migration-obsolete backend contract artifacts after backend, E2E, and app-client no longer depend on them. This includes the old renamed backend package, the reference backend package, generated OpenAPI backend exports and generation flow, old `openapi-fetch` dependencies where unused, temporary compatibility exports, and any obsolete direct `@ryot/app-backend/lib/*` consumers.

Do not run this before app-client and tests are migrated away from the legacy generated contract.

## Acceptance criteria

- [ ] No tests import generated OpenAPI backend path types
- [ ] App-client no longer imports generated OpenAPI backend path types
- [ ] Old backend and reference backend packages are removed from the workspace
- [ ] Obsolete generated OpenAPI backend exports and generation scripts are removed when no longer needed
- [ ] Unused `openapi-fetch` dependencies are removed from migrated packages
- [ ] Full repository checks are no longer blocked by legacy contract artifacts

## User stories addressed

Reference by number from the parent PRD:

- User story 51
- User story 52
- User story 53
- User story 62
