# Book Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Convert the book source families into SDK TypeScript modules: Hardcover book, person, company, and book-group; OpenLibrary book and person; Google Books book. Compile each through the trusted pipeline with static manifests, standard provider outputs, typed host methods, pinned SDK dependencies, ordinary title-case imports, and runtime validation of consumed GraphQL and REST fields.

Preserve API-key behavior, ISBN and external identifier resolution, publication dates, editions, images, descriptions, contributors, related entities, grouping, pagination, title normalization, and the OpenLibrary custom date parsing behavior. Keep provider-specific models and errors explicit while sharing only stable family-local request or normalization helpers.

## Acceptance criteria

- [ ] All seven Hardcover, OpenLibrary, and Google Books sources in this slice are SDK TypeScript modules
- [ ] Manifests preserve exact slugs, source metadata, host capabilities, and configuration requirements
- [ ] Title-case helpers and OpenLibrary custom date parsing use ordinary approved SDK imports
- [ ] Consumed GraphQL and REST response fields are runtime-validated
- [ ] Search, details, resolve, grouping, contributor relationships, identifiers, dates, editions, images, descriptions, and pagination behavior remains consistent
- [ ] Hardcover API-key failures and optional data handling remain consistent
- [ ] Existing book provider tests use typed SDK hosts and retain behavioral assertions
- [ ] Compiled Deno tests cover Hardcover GraphQL, OpenLibrary date parsing, and Google Books REST without live network calls
- [ ] Generated registry and seeding contain all converted providers exactly once
- [ ] Corresponding JavaScript sources and obsolete title-case injection are removed
- [ ] Backend and relevant E2E checks and tests pass

## User stories addressed

- User story 1
- User story 3
- User story 4
- User story 11
- User story 31
- User story 32
- User story 33
- User story 34
- User story 35
- User story 36
- User story 39
