# Search Providers on Entity Schemas

**Parent Plan:** [External Entity Search](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Extend the `GET /entity-schemas` list response so that every schema row includes a
`searchProviders` array. Each element identifies one search+details script pair linked to
that schema and carries the human-readable provider name (taken from the search script's
`name` column), the `searchScriptId`, and the `detailsScriptId`.

Schemas with no linked scripts must return an empty array (not `undefined` or a missing
field) so the frontend can iterate unconditionally.

See the **searchProviders on entity schemas** decision in the parent PRD for the exact
field shape and the join strategy.

## Acceptance criteria

- [ ] `GET /entity-schemas` response includes `searchProviders` on every schema row.
- [ ] Schemas with one or more `entitySchemaSandboxScript` rows return the correct provider
      entries (name, searchScriptId, detailsScriptId).
- [ ] Schemas with no linked scripts return `searchProviders: []`.
- [ ] `listedEntitySchemaSchema` in `modules/entity-schemas/schemas.ts` includes the
      `searchProviderSchema` field so the OpenAPI spec reflects the new shape.
- [ ] `bun run typecheck` and `bun test` pass in `apps/app-backend`.

## Blocked by

None — can start immediately.

## User stories addressed

- User story 2 — user can choose which external data source to search from
- User story 13 — `searchProviders` always included in `GET /entity-schemas` response
- User story 14 — empty array (not omitted) for schemas with no linked scripts
