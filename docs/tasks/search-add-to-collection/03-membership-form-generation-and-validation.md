# Membership Form Generation And Validation

**Parent Plan:** [Search Add To Collection](./README.md)

**Type:** AFK

**Status:** done

## What to build

Build the schema-backed membership form helper used by the collection panel.

This slice should translate a collection's `membershipPropertiesSchema` into initial values,
frontend validation, payload shaping, and generated inputs that render the schema's explicit
`label` metadata. The first pass should support the same flat primitive field shapes currently
produced by the collection-creation UI, keeping the implementation aligned with the existing
product contract.

See the parent PRD section **Membership form behavior**.

## Acceptance criteria

- [x] The frontend exposes a membership-form helper that can derive initial values from a selected
      collection template.
- [x] Generated membership inputs render the collection template's `label` values directly.
- [x] Collections with no membership template produce a valid form state without extra fields.
- [x] Required primitive fields are validated before submit.
- [x] The helper shapes the membership properties payload expected by the later save-orchestration
      slice.
- [x] The slice supports the same flat primitive schema shapes currently created by the collection
      creation UI.
- [x] Pure tests cover default values, required-field validation, label usage, and payload shaping.
- [x] `bun run typecheck` and the relevant frontend test command pass in `apps/app-frontend`.

## Blocked by

- [Task 01](./01-collection-discovery-and-navigation-helpers.md)

## User stories addressed

- User story 11
- User story 12
- User story 13
- User story 14
- User story 28
- User story 30
