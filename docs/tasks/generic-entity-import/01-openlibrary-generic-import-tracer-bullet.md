# OpenLibrary Generic Import Tracer Bullet

**Parent Plan:** [Generic Entity Import](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement the smallest complete generic import path using the existing OpenLibrary book import flow as the tracer bullet. This slice should prove that the public import endpoint can import a primary entity, consume the new `relatedEntities` script contract, create placeholder related entity rows, and write relationship rows without using person/company/group dispatcher jobs.

Use the parent PRD as the source of truth for the generic details result contract. The OpenLibrary book details script must return author references through `relatedEntities`, not through a `people` property. Each OpenLibrary author related entity must include `name`, `externalId`, `scriptSlug`, and `relationshipProperties`. The known OpenLibrary gap where author references omit `name` must be fixed in this slice. If no reliable author name is available, the script must return a placeholder such as `Loading...`.

The imported book remains the primary entity and gets populated normally. Related author rows are global placeholder entities with populated timestamp left null. Relationship rows must use author/person entity as source and imported book as target. Relationship properties are overwritten, not merged.

Keep the current public endpoint and current queue/job naming for this slice. If the current media-named worker/job remains in place, add the TODO comments required by the parent PRD for future naming and module cleanup.

## Acceptance criteria

- [ ] Importing an OpenLibrary book through the existing public import endpoint creates or updates the primary book entity and sets its populated timestamp.
- [ ] The OpenLibrary details script emits related authors through `relatedEntities` and no longer emits linked authors through a `people` property.
- [ ] Every related author reference emitted by OpenLibrary includes a non-empty `name`, `externalId`, `scriptSlug`, and `relationshipProperties` object.
- [ ] Related author placeholder entity rows are created or reused by related script, related external id, and related entity schema.
- [ ] Related author placeholder entity rows keep populated timestamp null.
- [ ] Relationship rows are written from related author entity to imported book entity using the derived relationship schema.
- [ ] Relationship properties contain the expected author role data and are validated against the relationship schema.
- [ ] Existing OpenLibrary import E2E coverage still passes for enqueueing, polling, primary properties, and primary populated timestamp.
- [ ] New E2E coverage verifies related author rows and relationship rows through observable API behavior or test database assertions.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 3
- User story 11
- User story 12
- User story 15
- User story 16
- User story 21
- User story 22
- User story 23
- User story 28
- User story 30
- User story 31
- User story 32
