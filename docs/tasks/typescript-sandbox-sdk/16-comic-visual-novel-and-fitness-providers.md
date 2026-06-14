# Comic, Visual Novel, and Fitness Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Convert Metron comic-book, person, and comic-book-group; VNDB visual-novel and company; and Free Exercise DB exercise into six SDK TypeScript provider modules. Use static manifests, typed host methods, standard provider outputs, approved Zod and Day.js imports, runtime payload validation, ordinary helpers, and trusted compilation.

Preserve Metron basic authentication, pagination, dates, images, people, publishers, series/groups, and relationships. Preserve VNDB query payloads, dates, images, developers/companies, and errors. Preserve Free Exercise DB normalization, search, recursive details where applicable, remote dataset loading, 80,000-byte cache chunking, cache metadata, cache TTL, and execution within the global resource limits.

## Acceptance criteria

- [ ] All six Metron, VNDB, and Free Exercise DB sources are SDK TypeScript modules
- [ ] Manifests preserve source metadata, exact capabilities, and Metron configuration requirements
- [ ] Metron authentication, search, details, people, groups, dates, images, and relationships remain consistent
- [ ] VNDB search, details, company mapping, dates, images, and errors remain consistent
- [ ] Free Exercise DB normalization, search, details, remote loading, cache chunking, metadata, and TTL remain consistent
- [ ] The 256 KiB cache-value limit remains compatible with the existing 80,000-byte exercise chunks
- [ ] External REST and dataset payload fields are runtime-validated
- [ ] Existing Metron and exercise tests use typed SDK hosts and retain app-owned assertions
- [ ] Compiled Deno tests cover Metron, VNDB, and exercise cache behavior without live network calls
- [ ] Generated registry and seeding contain all six providers exactly once
- [ ] Corresponding JavaScript sources are removed
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
