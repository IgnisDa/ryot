# Generic Import Validation And Relationship Overwrite

**Parent Plan:** [Generic Entity Import](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Harden the generic import processor around validation, error handling, idempotency, and overwrite-only relationship writes. This slice should make the generic import path safe for all provider scripts before the full script migration lands.

The processor must validate primary entity properties against the requested entity schema and validate each related entity reference before writing anything that depends on it. Missing related sandbox scripts, missing related script-to-entity-schema association, missing derived relationship schema, invalid primary properties, and invalid relationship properties must fail the import job instead of silently skipping data.

Relationship properties are always overwritten by the latest import result for the same source entity, target entity, and relationship schema. The backend must not merge `roles`, `character`, `order`, or any other relationship property. Scripts are responsible for aggregating duplicate relationship metadata before returning `relatedEntities`; if a script returns duplicate references for the same relationship, last write wins is acceptable.

## Acceptance criteria

- [ ] The generic import processor rejects invalid primary entity properties with a failed import job.
- [ ] The generic import processor rejects related entity references missing required identity or relationship fields.
- [ ] The generic import processor fails the import job when a related `scriptSlug` cannot be resolved.
- [ ] The generic import processor fails the import job when a related script has no usable entity schema association.
- [ ] The generic import processor fails the import job when no relationship schema can be derived from related schema as source and primary schema as target.
- [ ] The generic import processor rejects relationship properties that do not validate against the derived relationship schema.
- [ ] Re-importing the same relationship overwrites the relationship `properties` object instead of merging with previous properties.
- [ ] Existing primary entity idempotency behavior is preserved for populated and unpopulated global rows.
- [ ] Focused backend tests cover the validation and overwrite cases without depending on private implementation details.

## User stories addressed

Reference by number from the parent PRD:

- User story 13
- User story 14
- User story 15
- User story 16
- User story 17
- User story 20
- User story 21
- User story 22
- User story 25
