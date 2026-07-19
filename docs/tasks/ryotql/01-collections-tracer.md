# Collections Tracer

**Parent Plan:** [RyotQL](./README.md)

**Status:** todo

## What to build

Deliver the first complete RyotQL path by migrating the collections read. Build the independent `@ryot/ryotql` SDK, `@ryot/ryotql-recipes` package, strict wire contract, authenticated `POST /ryotql/execute` endpoint, backend service, user execution scope, entity catalog entry, basic field resolver, rows validation/compiler/executor, dynamic response reconstruction, and collection recipe. Replace the collection consumer with RyotQL while leaving the legacy query engine complete and passing.

This slice establishes the permanent named-query request and `{ data: ... }` response envelopes, explicit aliases, omitted optional AST fields, all-or-nothing validation, one read-only transaction, sequential named-query execution, generated SQL aliases, root pagination, true totals beyond the final page, deterministic primary-key tie breaking, nulls-last ordering, statement timeout, and the initial document/query/join limits from the parent PRD. It needs only the expression and output subset required by the collection recipe, but its interfaces must match the final RyotQL design so later slices extend rather than replace them.

## Acceptance criteria

- [ ] The RyotQL SDK and recipes packages exist independently from the legacy query-engine package and follow the dependency boundaries in the parent PRD
- [ ] The new authenticated contract operation accepts a strict named-query document and returns the agreed named data envelope
- [ ] The backend validates the complete document, opens one read-only transaction, applies the authenticated user's entity visibility, and executes each named query as one SQL statement
- [ ] The entity catalog exposes only the initial public fields and resolves physical fields through the uniform catalog interface
- [ ] Basic rows queries support field projection, equality and membership predicates needed by collections, ordering, pagination, runtime field kinds, and the retained safety limits
- [ ] Pagination reports the real total for empty pages beyond the result set and uses a stable primary-key tie breaker with nulls last
- [ ] The shared collections recipe builds a RyotQL document and the application collections consumer uses the RyotQL endpoint
- [ ] Contract, SDK, backend, recipe, client, and end-to-end collection tests cover the complete path
- [ ] The legacy query engine, its collection-independent consumers, and its test suite remain operational
- [ ] A separate RyotQL guide documents only the capabilities delivered so far without modifying the legacy guide

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 20
- User story 24
- User story 25
- User story 26
- User story 27
- User story 32
- User story 46
- User story 48
