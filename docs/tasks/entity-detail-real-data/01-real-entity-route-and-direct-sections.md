# Real Entity Route And Direct Sections

**Parent Plan:** [Entity Detail Real Data](./README.md)

**Type:** AFK

**Status:** completed

## What to build

Replace the demo entity-detail bootstrap with a real route-driven loader for the direct entity payload. The screen should start from `entityId`, fetch the entity with `GET /entities/{entityId}`, resolve the entity schema slug with `GET /entity-schemas/{entitySchemaId}`, and render the hero, about, details, and type-specific sections from live backend data.

This slice owns the direct, entity-owned fields only. It should remove the demo type-switching FAB, stop relying on fake entity data, and keep the current visual structure intact. For media types that already carry creator metadata directly on the entity payload, render that metadata from the real entity response instead of the fake dataset.

Follow the parent PRD decisions for supporting all built-in media types currently shown in the demo state.

## Acceptance criteria

- [x] The page loads real entity data from `GET /entities/{entityId}` instead of fake demo objects.
- [x] The entity schema lookup is used to resolve the current media type and drive the direct sections.
- [x] The hero, about, details, and type-specific sections render correctly for all built-in media types currently represented in the demo.
- [x] The type-switching FAB is removed.
- [x] Any direct creator metadata already present on the entity payload is rendered from backend data.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 4
- User story 9
- User story 10
- User story 11
- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 20
