# Entity Import Workflow Orchestration

**Parent Plan:** [Effect Workflow Orchestration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Refactor entity import so the entity import workflow owns the full provider-backed import process instead of delegating the entire process to one durable queue worker. The workflow should check whether the global entity is already populated, load the required script and schema metadata, execute the details sandbox step as workflow-owned durable work, validate the sandbox details result, write the primary global entity, write related placeholder entities and relationships, and ensure the imported primary entity is in the user's library.

The sandbox details step should be composed from inside the entity import workflow by executing the sandbox workflow or processing the sandbox execution durable queue directly. Do not call the raw workflow engine from entity population helpers for this parent-owned details step. Split entity population helpers into workflow-friendly operations where needed so the workflow can compose the durable boundaries directly.

Standalone direct search or direct sandbox use outside a parent workflow may keep using a top-level service boundary, as described in the parent PRD. This task is about the entity import path.

## Acceptance criteria

- [ ] Entity import workflow `toLayer` contains the import process graph and is not a single pass-through durable queue call
- [ ] Entity import no longer relies on a whole-import durable queue worker that performs all business logic opaquely
- [ ] Entity details sandbox execution is owned by the entity import workflow body through child workflow execution or direct durable queue processing
- [ ] Entity population helpers no longer call the raw workflow engine for entity import's details sandbox step
- [ ] A matching already-populated global entity short-circuits details sandbox execution while still ensuring user library membership
- [ ] New or unpopulated global entities are populated through sandbox details, result decoding, schema property validation, primary entity persistence, related placeholder persistence, relationship persistence, and library membership
- [ ] Repository writes and service side effects in the workflow are wrapped in durable activities or otherwise made replay-safe
- [ ] Existing product behavior for starting an entity import and polling its result remains product-compatible
- [ ] Tests cover successful import, sandbox details failure, already-populated short-circuit behavior, related entity and relationship writes, and library membership

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 3
- User story 6
- User story 7
- User story 9
- User story 10
- User story 12
- User story 13
- User story 20
- User story 24
- User story 25
- User story 26
- User story 27
- User story 30
- User story 31
- User story 32
- User story 33
