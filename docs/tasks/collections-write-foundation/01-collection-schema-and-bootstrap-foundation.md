# Collection Schema And Bootstrap Foundation

**Parent Plan:** [Collections Write Foundation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Establish the platform-level collection foundation needed for all later write slices. This task
adds the built-in `collection` entity schema, aligns the built-in `Collections` saved view to that
schema, and extends object-property schema handling with an explicit unknown-key policy so a nested
`membershipPropertiesSchema` can be preserved safely.

The end-to-end result should be that a fresh bootstrap includes a real built-in `collection`
entity schema, the built-in `Collections` saved view points at it directly, and object properties
remain strict by default while allowing explicit passthrough behavior where the parent PRD requires
it. See the parent PRD sections **Built-in collection schema** and **Validation model**.

## Acceptance criteria

- [ ] Built-in bootstrap seeds a real `collection` entity schema as part of the default platform
      model.
- [ ] The built-in `Collections` saved view targets the built-in `collection` entity schema
      directly.
- [ ] Object properties support an explicit unknown-key policy with strict behavior as the default.
- [ ] The collection schema foundation can preserve a nested `membershipPropertiesSchema` object
      without weakening strict validation for unrelated schemas.
- [ ] Backend tests cover the new object-property unknown-key behavior.
- [ ] `tests/src` includes an API-level assertion that a fresh authenticated user can observe the
      built-in collection schema foundation through existing bootstrap-visible surfaces.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 15
- User story 19
- User story 25
- User story 26
- User story 27
