# Comic, Visual Novel, and Fitness Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Convert Metron comic-book, person, and comic-book-group; VNDB visual-novel and company; and Free Exercise DB exercise into six SDK TypeScript provider modules. Use static manifests, typed host methods, standard provider outputs, approved Zod and Day.js imports, runtime payload validation, ordinary helpers, and trusted compilation.

Preserve Metron basic authentication, pagination, dates, images, people, publishers, series/groups, and relationships. Preserve VNDB query payloads, dates, images, developers/companies, and errors. Preserve Free Exercise DB normalization, search, recursive details where applicable, remote dataset loading, 80,000-byte cache chunking, cache metadata, cache TTL, and execution within the global resource limits.

## Acceptance criteria

- [x] All six Metron, VNDB, and Free Exercise DB sources are SDK TypeScript modules
- [x] Manifests preserve source metadata, exact capabilities, and Metron configuration requirements
- [x] Metron authentication, search, details, people, groups, dates, images, and relationships remain consistent
- [x] VNDB search, details, company mapping, dates, images, and errors remain consistent
- [x] Free Exercise DB normalization, search, details, remote loading, cache chunking, metadata, and TTL remain consistent
- [x] The 256 KiB cache-value limit remains compatible with the existing 80,000-byte exercise chunks
- [x] External REST and dataset payload fields are runtime-validated
- [x] Existing Metron and exercise tests use typed SDK hosts and retain app-owned assertions
- [x] Compiled Deno tests cover Metron, VNDB, and exercise cache behavior without live network calls
- [x] Generated registry and seeding contain all six providers exactly once
- [x] Corresponding JavaScript sources are removed
- [x] Backend and relevant E2E checks and tests pass

## Implementation notes

- Converted Metron (`comic-book`, `person`, `comic-book-group`), VNDB (`visual-novel`, `company`), and Free Exercise DB (`exercise`) to SDK TypeScript modules; Metron and VNDB each share a `providers/<name>-shared.ts` helper, while Free Exercise DB is a single self-contained module.
- Capabilities: Metron `["httpCall", "getAppConfigValue"]` (Basic auth; keys `providers.metronUsername`/`providers.metronPassword`); VNDB `["httpCall"]` (no auth/config); Free Exercise DB `["httpCall", "getCachedValue", "setCachedValue"]` (remote dataset + normalized cache). All source-only (no canonical language).
- Metron Basic auth (`btoa(user:pass)`), issue-title formatting, per-role credit dedup, series grouping, and up-to-3-arc suggestions are preserved; VNDB Kana POST queries, partial-date parsing, `devstatus` mapping, and developer→company grouping are preserved (with the legacy company-search fixed page size of 20). Free Exercise DB preserves dataset normalization, `Date.now()` cache versioning, and the 80,000-byte chunking scheme (comfortably within the 256 KiB cache-value limit); cached chunk contents are re-narrowed on read so malformed cache entries are treated as a miss.
- Because this migrates the last legacy provider fragments, the registry's remaining `providerScript`/`script`/`BUILTIN_ALLOWED_HOST_FUNCTIONS` scaffolding and all provider `.sandbox.js` text imports were removed; `builtinSandboxScripts()` is now purely generated format-1 entries. (The Deno runner-source `.sandbox.js` text imports are infrastructure and remain.)
- Deno runner-integration tests execute representative Metron (`search` via Basic auth), VNDB (`search`), and Free Exercise DB (`search`, asserting the cache-miss fetch normalizes and writes a chunk + `{version, chunkCount}` metadata) drivers with canned host responses.

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
