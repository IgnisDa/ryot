# Built-In Provider Compilation Tracer

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Establish the trusted built-in path in the Driver Contracts and Built-In Compilation sections after Tasks 01 through 05. Add standard provider schemas and helpers, batch compilation, generated registry output, build/check/test integration, development watch behavior, seeding of source plus compiled code, and Effect-schema parity. Convert TMDB Show, the largest current provider, as the representative end-to-end built-in.

TMDB Show must become a normal SDK provider module using ordinary imports, pinned SDK dependencies, exact manifest capabilities and configuration keys, typed `search`, `details`, `resolve`, and `translate` drivers, standard output schemas, and current behavior. The generated registry must replace raw source loading for this entry and provide source, compiled code, format, and manifest to seeding. Direct TypeScript tests and compiled Deno tests must both run. Do not bulk-convert other provider families in this slice.

## Acceptance criteria

- [x] The SDK exposes standard search, details, resolve, and translate schemas and inferred driver contracts described by the parent PRD
- [x] Backend Effect decoders are constrained to SDK encoded types and parity tests cover representative provider values
- [x] A trusted batch compiler discovers built-in entries, supports relative helper imports, and emits one ESM module plus manifest per script
- [x] Generated built-in modules and registry output remain out of version control
- [x] Backend check, test, build, and development workflows run or watch built-in compilation so generated output cannot be stale
- [x] Production bundling embeds generated code as text and seeding stores TypeScript source, compiled code, compiled format, and manifest
- [x] TMDB Show is fully converted to an SDK TypeScript provider without legacy globals, direct npm specifiers, or helper concatenation
- [x] TMDB Show preserves current search, details, resolve, translate, metadata, canonical language, configuration, and result behavior
- [x] TMDB Show compiles under normal TypeScript checking and the trusted sandbox compiler
- [x] Existing TMDB Show behavioral tests pass through typed SDK test hosts
- [x] A Deno integration test loads and executes the compiled TMDB Show module with deterministic host/package stand-ins
- [x] Every acceptance path respects the limits introduced in Task 05

## Implementation notes

- Added the explicit `@ryot/sandbox-sdk/provider` surface with provider manifests, standard driver schemas, inferred provider drivers, recursive details contracts, and provider definitions. Backend Effect schemas are typed against those SDK result types and have representative parity coverage.
- Added `@ryot/sandbox-compiler/builtins`. The backend compilation command discovers `.sandbox.ts` entries, type-checks their trusted virtual import graph, permits only SDK and contained relative imports, applies the existing manifest and byte limits, and emits one inline-source-mapped ESM file per entry plus an ignored generated registry.
- Backend `check`, `test`, and `build` compile built-ins before consuming the registry. Development compiles once before startup and polls the authored sandbox tree for changes, regenerating the registry so Bun's application watcher reloads it.
- TMDB Show is now a format-1 provider module split into an entry, shared client helpers, details helpers, and translation helpers. The split keeps authored files below the repository size limit and exercises trusted relative import bundling. All other provider families remain on the planned temporary format-0 path.
- Seeding accepts an already compiled representation for migrated entries and continues compiling untouched legacy entries through the format-0 adapter. The generated TMDB entry supplies source, compiled code, format `1`, and the validated manifest to the same seed loop.
- Bun initially bundled the provider module's relative Zod wrapper instead of leaving the approved SDK dependency external. That duplicate bundle failed in Deno with an incomplete lazy method binding. Importing Zod through `@ryot/sandbox-sdk/zod` inside the provider surface keeps the pinned runtime module authoritative and resolved the issue.

## Verification

- `bun run test` in `libs/sandbox-sdk`: 7 tests passed.
- Focused backend provider, compiler, parity, registry, metadata-lookup, and Deno coverage passed.
- `bun run test` in `apps/app-backend`: 143 files and 880 tests passed.
- `bun turbo --filter=@ryot/app-backend check` passed without warnings.
- `bun turbo --filter=@ryot/app-backend build` passed and embedded the generated registry in the backend bundle.
- Repository-wide `bun turbo check` was attempted but remains blocked by the unrelated empty `@ryot/graphql` package using removed `moduleResolution=node10`; Task 06's packages and backend checks pass.

## User stories addressed

- User story 3
- User story 4
- User story 31
- User story 32
- User story 33
- User story 34
- User story 35
- User story 36
