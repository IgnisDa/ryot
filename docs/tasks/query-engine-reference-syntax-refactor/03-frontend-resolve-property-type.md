# Frontend resolvePropertyType Update

**Parent Plan:** [Query Engine Reference Syntax Refactor](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update `resolvePropertyType` in the frontend saved-views feature and its unit
tests to handle the new path syntax:

- **3-segment built-in paths** — `entity.{slug}.{column}` maps to a `BUILTIN_TYPES`
  lookup. The keys in `BUILTIN_TYPES` no longer carry the `@` prefix (`"name"`,
  `"createdAt"`, `"updatedAt"` instead of `"@name"`, `"@createdAt"`, `"@updatedAt"`).
  The `property.startsWith("@")` guard is removed.
- **4-segment schema property paths** — `entity.{slug}.properties.{property}` looks
  up the property in the matching schema's `fields`. Only one level of nesting is
  resolved here; deeper paths (5+ segments) return `null`.
- **Everything else** — event paths, unknown segment counts, unknown slugs, and
  missing properties all continue to return `null`.

Update all unit test cases in `resolve-property-type.test.ts` to use the new path
strings (e.g. `"entity.anime.name"` instead of `"entity.anime.@name"`, and
`"entity.anime.properties.year"` instead of `"entity.anime.year"`).

After this slice `bun run test` and `bun run lint` pass inside `apps/app-frontend`.

## Acceptance criteria

- [x] `resolvePropertyType("entity.anime.name", emptySchemas)` returns `"string"`.
- [x] `resolvePropertyType("entity.anime.createdAt", emptySchemas)` returns `"date"`.
- [x] `resolvePropertyType("entity.anime.updatedAt", emptySchemas)` returns `"date"`.
- [x] `resolvePropertyType("entity.anime.image", emptySchemas)` returns `null`
  (image is display-only, not in `BUILTIN_TYPES`).
- [x] `resolvePropertyType("entity.anime.properties.year", [animeSchema])` returns
  `"integer"`.
- [x] `resolvePropertyType("entity.anime.properties.title", [animeSchema])` returns
  `"string"`.
- [x] Old paths such as `"entity.anime.@name"` and `"entity.anime.year"` return
  `null` (they are no longer valid).
- [x] `resolvePropertyType("event.review.rating", schemas)` continues to return
  `null`.
- [x] `bun run test` and `bun run lint` pass in `apps/app-frontend`.

## Blocked by

- [Task 02](./02-openapi-spec-regeneration.md)

## User stories addressed

- User story 10
