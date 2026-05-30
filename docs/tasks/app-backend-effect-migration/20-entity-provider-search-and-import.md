# Entity Provider Search And Import

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate provider-backed entity search and entity import behavior on top of the sandbox runtime and Effect Workflow. Entity-schema search should execute provider search drivers and expose pollable results. Entity import should execute provider details drivers, populate or reuse global entities, validate properties, and add the primary entity to the user's library.

This slice should avoid BullMQ and should model asynchronous progress with durable workflow primitives.

## Acceptance criteria

- [ ] Authenticated users can start provider-backed entity searches
- [ ] Authenticated users can poll entity search results
- [ ] Authenticated users can start provider-backed entity imports
- [ ] Authenticated users can poll entity import results
- [ ] Imported primary entities validate properties and are added to the user's library
- [ ] Entity-schema search/import E2E scenarios pass through the Effect client

## User stories addressed

Reference by number from the parent PRD:

- User story 27
- User story 28
- User story 37
- User story 42
