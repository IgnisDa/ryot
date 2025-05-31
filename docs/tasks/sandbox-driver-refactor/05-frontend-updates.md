# Frontend Updates

**Parent Plan:** [Sandbox Driver Refactor](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Update the frontend to consume the revised API contracts introduced in Tasks 03 and 04. The
search-and-add flow — user searches for media, picks a result, details are fetched, entity is
created — must work identically from the user's perspective. Only the underlying field names
and enqueue payloads change.

See the **Frontend** section of the parent PRD for the full design.

## Acceptance criteria

- [ ] `use-search.ts` enqueues search using `provider.scriptId` and `driverName: "search"`
      instead of `provider.searchScriptId` with no `driverName`.
- [ ] `use-search.ts` enqueues details using `provider.scriptId` and `driverName: "details"`
      instead of `provider.detailsScriptId` with no `driverName`.
- [ ] `use-search.ts` passes `sandboxScriptId` (not `detailsSandboxScriptId`) in the entity
      creation payload.
- [ ] `model.ts` for entities maps `sandboxScriptId` from the API response instead of
      `detailsSandboxScriptId`.
- [ ] The `entity-schemas.ts` test fixture uses `providers: []` instead of
      `searchProviders: []`.
- [ ] The `entities.ts` test fixture uses `sandboxScriptId: null` instead of
      `detailsSandboxScriptId: null`.
- [ ] `bun run typecheck` and `bun test` pass in `apps/app-frontend`.
- [ ] The full search-and-add flow works end-to-end in the running application with no visible
      change to the user experience.

## Blocked by

- [Task 03](./03-entity-schemas-providers-and-seed.md)
- [Task 04](./04-entities-field-rename.md)

## User stories addressed

- User story 6
- User story 7
- User story 8
