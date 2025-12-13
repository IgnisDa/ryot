# End-to-End Sandbox Fixtures

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate the end-to-end package as specified by the End-to-End Test Package Migration and Testing Decisions sections after the generic, host, provider, trigger, diagnostic, and limit paths exist. Replace legacy JavaScript source strings with centralized single-file TypeScript source builders, update API payloads and structured result assertions, and ensure every executable fixture is compiled by the authoritative creation endpoint.

Implement the API-compile-then-promote flow for global fake providers and trending scripts that public APIs cannot create. For replacement scenarios without an update endpoint, compile a temporary script through the API, copy its full source/compiled/format/manifest representation through one fixture-owned SQL operation, and remove the temporary row. Migrate the generic sandbox, cache, async host, before-create trigger, provider, import, translation, interest, trending, and media-monitoring fixtures that currently create, insert, or mutate executable source. Preserve hermetic fake-provider behavior and existing cleanup ordering. Do not create a test-only compiler or import backend compiler internals.

## Acceptance criteria

- [x] The end-to-end package depends on `@ryot/sandbox-sdk` and uses its public types for fixture manifests and driver data
- [x] Central fixture builders emit complete SDK TypeScript modules for generic, provider, trigger, cache, host, query, translation, and throwing scenarios
- [x] API-created scripts send only TypeScript source and obtain name, slug, metadata, and capabilities from the manifest
- [x] Invalid TypeScript and undeclared host usage are asserted as creation-time HTTP 400 failures with diagnostics
- [x] Runtime capability enforcement remains covered through a deliberately altered persisted manifest rather than uncompilable source
- [x] Polling and completion assertions render structured phase, message, location, and sanitized stack
- [x] Global fake providers and trending scripts are compiled through the creation API before SQL promotion
- [x] Promotion preserves source, compiled code, compiled format, name, slug, and manifest while changing only required ownership and built-in fields
- [x] Provider replacement fixtures compile a temporary module through the API before copying the compiled representation and cleaning up the temporary row
- [x] Direct SQL fixtures use the new script columns and never store uncompiled source as executable code
- [x] Search, import, population, translation, relationships, trending, monitoring, interest, trigger ordering, cache, host, timing, authorization, and job polling assertions retain their prior behavior
- [x] All hermetic provider suites remain offline except the intentionally gated live smoke suite
- [x] Test-package guidance documents the new fixture model and no unrelated seed-script refactor is performed
- [x] No legacy `driver(...)` source generator remains in the migrated E2E surface
- [x] The end-to-end package check and test suite pass

## Implementation notes

- Added centralized single-file SDK module builders for literal and invalid generic scripts, cache operations, HTTP and application hosts, query-engine calls, throwing drivers, trending, provider search/details/translation, and both trigger phases. Fixture values are SDK-typed and serialized as JSON rather than interpolated as executable test input.
- Removed the temporary legacy creation adapter and changed every API-owned fixture to submit only `{ source }`. Creation coverage now rejects real TypeScript type errors, non-static manifests, forbidden direct package imports, and undeclared host methods before persistence.
- Reworked global provider and trending setup to compile through the authenticated creation endpoint, then promote the exact row by changing only `is_builtin` and `user_id`. The helper compares source, compiled JavaScript, format, name, slug, and manifest before and after promotion.
- Reworked media-monitoring provider replacement to compile a temporary module through the API, copy its complete compiled representation in one SQL update, verify the copy, and remove the temporary row without masking an earlier replacement failure.
- Migrated search, import, relationships, population, translation, interest, trending, monitoring, cache, host, authorization, polling, and trigger fixtures to the new module format while retaining their existing assertions and hermetic behavior.
- Added structured sandbox failure rendering with phase, mapped location, message, and sanitized stack, and updated test guidance to document API compilation, promotion, replacement, and cleanup ownership.

## Problems and deviations

- The plan expected persisted capability tampering to reach driver execution with the omitted host method filtered out. The format-1 runner already performs a stronger manifest-integrity check, so the altered manifest is rejected during the `load` phase before any driver code can run. The E2E assertion follows that existing security behavior rather than weakening it to manufacture an undefined host call.
- An initial full-suite run inherited `RUN_LIVE_PROVIDER_TESTS` from the environment, so the intentionally external OpenLibrary smoke timed out. The same heavily concurrent run also had transient trending and entity-schema poll timeouts; both hermetic cases passed immediately in isolation. The documented hermetic command with the live gate disabled then passed the complete suite.
- No blocker remained. The package already declared `@ryot/sandbox-sdk`, so this task consumed and expanded its public types without changing dependency metadata. The unrelated seed script was not modified.

## Verification

- `bun run check` in `tests` passed.
- `bun turbo --filter=@ryot/tests check` passed, including dependency package checks.
- `bun run test -- src/sandbox` in `tests`: 25 tests passed.
- Focused provider, import, translation, interest, monitoring, trending, and trigger run: 39 tests passed.
- `RUN_LIVE_PROVIDER_TESTS=0 bun run test` in `tests`: 512 tests passed and 2 gated live tests skipped.

## User stories addressed

- User story 34
- User story 35
- User story 36
- User story 41
- User story 42
- User story 43
- User story 44
- User story 45
