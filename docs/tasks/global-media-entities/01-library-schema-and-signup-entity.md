# Library Schema and Signup Entity

**Parent Plan:** [Global Media Entities & User Library](./README.md)

**Type:** AFK

**Status:** todo

## Backwards compatibility

Backwards compatibility with existing user-scoped media entity rows is not required.

## What to build

Introduce the `library` builtin entity schema and ensure every new user gets exactly one library entity at signup.

**Bootstrap manifests** — Add a `library` entry to the builtin entity schema seed data with `slug = 'library'`, `isBuiltin = true`, an empty `propertiesSchema`, and no tracker link. The schema must not appear in `authenticationBuiltinEntitySchemas()` tracker links so it is invisible in all entity listings and the query engine.

**Signup transaction** — Inside the existing `db.transaction` in the authentication email route (alongside tracker creation, entity schema linking, and saved view creation), look up the builtin `library` schema and insert a user-scoped entity (`userId = signUpResult.user.id`, `entitySchemaId = librarySchema.id`, `name = "Library"`, `externalId = null`, `sandboxScriptId = null`). Extract a `createLibraryEntityForUser` repository function in the collections or a new library module (following the pattern of `createCollectionForUser`).

**Unit tests** — Add tests to `authentication/service.test.ts` (or a colocated test) covering the new bootstrap helper that constructs the library entity input, matching the existing pattern for `buildAuthenticationTrackerInputs`.

**E2E tests** — No new e2e test is required here since the library entity is invisible to the API. Correctness is verified transitively by tasks that depend on the library entity existing.

## Acceptance criteria

- [ ] A `library` builtin entity schema row is seeded on server start alongside book, anime, manga, person, and collection.
- [ ] `authenticationBuiltinEntitySchemas()` does NOT include `library` in its tracker links so it never appears in query engine results.
- [ ] Every new user signup creates exactly one library entity (`userId = user.id`, `entitySchemaId = librarySchema.id`) inside the same transaction as the rest of signup bootstrapping.
- [ ] If the `library` schema does not exist at signup time, the signup transaction throws a clear error rather than silently continuing.
- [ ] Unit tests cover the library entity bootstrap helper (valid input → correct shape, missing library schema → throws).
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

None — can start immediately.

## User stories addressed

- User story 2 (library exists for every user)
- User story 14 (signup auto-provisions library)
