# End-to-End Sandbox Fixtures

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate the end-to-end package as specified by the End-to-End Test Package Migration and Testing Decisions sections after the generic, host, provider, trigger, diagnostic, and limit paths exist. Replace legacy JavaScript source strings with centralized single-file TypeScript source builders, update API payloads and structured result assertions, and ensure every executable fixture is compiled by the authoritative creation endpoint.

Implement the API-compile-then-promote flow for global fake providers and trending scripts that public APIs cannot create. For replacement scenarios without an update endpoint, compile a temporary script through the API, copy its full source/compiled/format/manifest representation through one fixture-owned SQL operation, and remove the temporary row. Migrate the generic sandbox, cache, async host, before-create trigger, provider, import, translation, interest, trending, and media-monitoring fixtures that currently create, insert, or mutate executable source. Preserve hermetic fake-provider behavior and existing cleanup ordering. Do not create a test-only compiler or import backend compiler internals.

## Acceptance criteria

- [ ] The end-to-end package depends on `@ryot/sandbox-sdk` and uses its public types for fixture manifests and driver data
- [ ] Central fixture builders emit complete SDK TypeScript modules for generic, provider, trigger, cache, host, query, translation, and throwing scenarios
- [ ] API-created scripts send only TypeScript source and obtain name, slug, metadata, and capabilities from the manifest
- [ ] Invalid TypeScript and undeclared host usage are asserted as creation-time HTTP 400 failures with diagnostics
- [ ] Runtime capability enforcement remains covered through a deliberately altered persisted manifest rather than uncompilable source
- [ ] Polling and completion assertions render structured phase, message, location, and sanitized stack
- [ ] Global fake providers and trending scripts are compiled through the creation API before SQL promotion
- [ ] Promotion preserves source, compiled code, compiled format, name, slug, and manifest while changing only required ownership and built-in fields
- [ ] Provider replacement fixtures compile a temporary module through the API before copying the compiled representation and cleaning up the temporary row
- [ ] Direct SQL fixtures use the new script columns and never store uncompiled source as executable code
- [ ] Search, import, population, translation, relationships, trending, monitoring, interest, trigger ordering, cache, host, timing, authorization, and job polling assertions retain their prior behavior
- [ ] All hermetic provider suites remain offline except the intentionally gated live smoke suite
- [ ] Test-package guidance documents the new fixture model and no unrelated seed-script refactor is performed
- [ ] No legacy `driver(...)` source generator remains in the migrated E2E surface
- [ ] The end-to-end package check and test suite pass

## User stories addressed

- User story 34
- User story 35
- User story 36
- User story 41
- User story 42
- User story 43
- User story 44
- User story 45
