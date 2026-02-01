# OpenAPI Spec Regeneration

**Parent Plan:** [Query Engine Reference Syntax Refactor](./README.md)

**Type:** AFK

**Status:** done

## What to build

Regenerate the OpenAPI spec from the updated backend after the core type changes
land. The `RuntimeRef` schema now exposes `property: string[]` instead of
`property: string`, so the generated spec and the downstream `@ryot/generated`
package must be updated before any consumers of those types (frontend, E2E test
infrastructure) can be updated.

Run the standard regeneration command documented in the backend `AGENTS.md`:

```
bun run --filter=@ryot/generated app-backend-openapi
```

Note: this command requires the dev server to be running. Check before starting.

Commit the updated generated files.

## Acceptance criteria

- [x] Dev server is running before the regeneration command is invoked.
- [x] The regeneration command completes without error.
- [x] The generated `@ryot/generated` package reflects `property: string[]` for
  `schema-property` and `event-join-property` `RuntimeRef` variants.
- [x] No other unrelated spec drift is included in the commit.

## Blocked by

- [Task 01](./01-core-type-parser-and-sql.md)

## User stories addressed

- User story 3 (enabling downstream consumers to use deep paths)
