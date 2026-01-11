# Built-In Provider Compilation Tracer

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Establish the trusted built-in path in the Driver Contracts and Built-In Compilation sections after Tasks 01 through 05. Add standard provider schemas and helpers, batch compilation, generated registry output, build/check/test integration, development watch behavior, seeding of source plus compiled code, and Effect-schema parity. Convert TMDB Show, the largest current provider, as the representative end-to-end built-in.

TMDB Show must become a normal SDK provider module using ordinary imports, pinned SDK dependencies, exact manifest capabilities and configuration keys, typed `search`, `details`, `resolve`, and `translate` drivers, standard output schemas, and current behavior. The generated registry must replace raw source loading for this entry and provide source, compiled code, format, and manifest to seeding. Direct TypeScript tests and compiled Deno tests must both run. Do not bulk-convert other provider families in this slice.

## Acceptance criteria

- [ ] The SDK exposes standard search, details, resolve, and translate schemas and inferred driver contracts described by the parent PRD
- [ ] Backend Effect decoders are constrained to SDK encoded types and parity tests cover representative provider values
- [ ] A trusted batch compiler discovers built-in entries, supports relative helper imports, and emits one ESM module plus manifest per script
- [ ] Generated built-in modules and registry output remain out of version control
- [ ] Backend check, test, build, and development workflows run or watch built-in compilation so generated output cannot be stale
- [ ] Production bundling embeds generated code as text and seeding stores TypeScript source, compiled code, compiled format, and manifest
- [ ] TMDB Show is fully converted to an SDK TypeScript provider without legacy globals, direct npm specifiers, or helper concatenation
- [ ] TMDB Show preserves current search, details, resolve, translate, metadata, canonical language, configuration, and result behavior
- [ ] TMDB Show compiles under normal TypeScript checking and the trusted sandbox compiler
- [ ] Existing TMDB Show behavioral tests pass through typed SDK test hosts
- [ ] A Deno integration test loads and executes the compiled TMDB Show module with deterministic host/package stand-ins
- [ ] Every acceptance path respects the limits introduced in Task 05

## User stories addressed

- User story 3
- User story 4
- User story 31
- User story 32
- User story 33
- User story 34
- User story 35
- User story 36
