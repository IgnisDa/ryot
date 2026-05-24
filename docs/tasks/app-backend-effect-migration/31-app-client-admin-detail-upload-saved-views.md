# App Client Admin Detail Upload Saved Views

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Finish app-client migration for the remaining known backend route call sites: entity detail, entity schema detail, saved-view detail execution, uploads download URL usage, and god-mode admin operations. Replace direct generated OpenAPI path calls with typed Effect contract calls and direct success/error handling.

After this slice, app-client should no longer depend on generated OpenAPI backend path types for app-owned routes.

## Acceptance criteria

- [ ] Entity detail and entity-schema detail screens use the Effect client
- [ ] Saved-view screen route calls and query execution use the Effect client
- [ ] Upload download URL helper uses the Effect client
- [ ] God-mode app-client route calls use the Effect client and admin token header behavior
- [ ] App-client no longer imports generated OpenAPI backend path types
- [ ] App-client check passes for migrated API call sites

## User stories addressed

Reference by number from the parent PRD:

- User story 48
- User story 49
- User story 50
- User story 51
- User story 53
