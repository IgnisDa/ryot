# Refresh Generated Media Lifecycle Contract

**Parent Plan:** [Built-in Media Lifecycle Actions](./README.md)

**Type:** AFK

**Status:** todo

## What to build

After the four lifecycle actions exist end-to-end, refresh the generated backend contract and
align the parent plan with the implemented write model. This slice should ensure the seeded
built-in media lifecycle behavior is reflected in the generated API surface and documented testable
contract.

This is the finishing pass that makes the new lifecycle foundation easy for later frontend and
integration work to consume.

See the **API contract shape**, **Built-in event schema registration**, and **Further Notes**
sections of the parent PRD.

## Acceptance criteria

- [ ] The OpenAPI spec is regenerated after the backend contract changes.
- [ ] Generated API types reflect the final built-in media lifecycle write contract.
- [ ] The parent PRD remains aligned with the implemented lifecycle event semantics.
- [ ] Any backend-facing test fixtures or contract helpers needed for the final lifecycle model are
      updated.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 02](./02-backlog-events-for-built-in-media.md)
- [Task 03](./03-progress-events-for-built-in-media.md)
- [Task 04](./04-complete-events-for-built-in-media.md)
- [Task 05](./05-review-events-for-built-in-media.md)

## User stories addressed

- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 20
- User story 21
- User story 22
- User story 23
- User story 24
- User story 25
