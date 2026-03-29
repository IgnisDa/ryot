# Entity Schemas Providers and Seed

**Parent Plan:** [Sandbox Driver Refactor](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Three tightly coupled changes that must land together:

1. **Provider scripts** — merge each provider's `search.txt` + `details.txt` into a single
   `index.txt` using the `driver("search", fn)` / `driver("details", fn)` pattern introduced
   in Task 01. Shared helper functions appear once at the top of the combined file.

2. **Seed data** — halve the built-in script manifest (16 entries → 8), drop
   `linkScriptPairToEntitySchema` in favour of `linkScriptToEntitySchema`, and update all slug
   references to drop the `.search` / `.details` suffix (e.g. `anilist.anime.search` →
   `anilist.anime`).

3. **Entity schemas module** — update the repository to join `entitySchemaScript` instead of
   `entitySchemaSandboxScript`, replace `searchProviderSchema` with `providerSchema`
   (`{ name, scriptId }`), rename the response field from `searchProviders` to `providers`,
   and regenerate the OpenAPI spec.

See the **Entity schemas module**, **Seed data**, and **Media-provider scripts** sections of
the parent PRD for the full design.

## Acceptance criteria

- [ ] Every provider directory under `scripts/media-providers/` contains a single `index.txt`
      that declares both a `search` and a `details` driver. The separate `search.txt` and
      `details.txt` files are deleted.
- [ ] Shared helper functions within a provider (e.g. `parseJsonResponse`, `collectGenres`,
      `toTitleCase`) appear exactly once in `index.txt`, above both driver declarations.
- [ ] The `sandboxScripts` array in the seed manifest contains 8 entries (one per provider),
      each with a slug that has no `.search` or `.details` suffix.
- [ ] `entitySchemaScriptLinks` in the seed manifest contains 8 entries, each mapping a schema
      slug to a single script slug.
- [ ] `linkScriptToEntitySchema` in seed helpers inserts a row into `entity_schema_script`
      (not the old `entity_schema_sandbox_script`). `linkScriptPairToEntitySchema` is removed.
- [ ] The entity-schemas repository builds `providers: Array<{ name, scriptId }>` from a join
      to `entitySchemaScript` + `sandboxScript`. The `searchProviders` field is gone.
- [ ] `searchProviderSchema` in `modules/entity-schemas/schemas.ts` is replaced by
      `providerSchema` with fields `name` and `scriptId` only.
- [ ] `listedEntitySchemaSchema` uses `providers` (not `searchProviders`) for the array field.
- [ ] The OpenAPI spec is regenerated and the generated types in
      `libs/generated/src/openapi/app-backend.d.ts` reflect `providers` with `scriptId`.
- [ ] `bun run typecheck` and `bun test` pass in `apps/app-backend`.

## Blocked by

- [Task 02](./02-db-schema-update.md)

## User stories addressed

- User story 1
- User story 4
- User story 5
- User story 6
