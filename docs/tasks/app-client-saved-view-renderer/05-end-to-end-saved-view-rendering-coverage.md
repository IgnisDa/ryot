# End-To-End Saved View Rendering Coverage

**Parent Plan:** [App Client Saved View Renderer](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add shared E2E/API coverage where needed to prove the new saved-view display contract and runtime integration work through the HTTP API. This task should focus on externally observable behavior that cannot be fully covered by module unit tests.

Good coverage should create or fetch saved views through the API, assert that the new display configuration fields are persisted and returned, assert that invalid display configurations fail through saved-view create/update validation, and verify that query-engine execution can resolve the fields required by the app-client renderer. Do not add brittle UI automation for the app-client unless the existing test setup already supports it cheaply.

## Acceptance criteria

- [ ] HTTP/API tests cover creating or retrieving a saved view with `entityIdProperty` and grid/list `eyebrowProperty`
- [ ] HTTP/API tests cover invalid `entityIdProperty` validation through saved-view create or update
- [ ] HTTP/API tests cover invalid null grid/list title or empty table columns through saved-view create or update
- [ ] Query-engine execution through existing endpoints can resolve fields needed for at least one grid/list-style request and one table-style request
- [ ] Tests assert meaningful returned values and validation messages rather than smoke-only status checks
- [ ] No app-client UI automation is added unless it is cheap and consistent with existing test infrastructure

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 8
- User story 11
- User story 26
- User story 27
- User story 28
- User story 29
- User story 30
