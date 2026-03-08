# Migrate Books and Serial Media Providers

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Migrate the media provider families under anime, manga, book, audiobook, comic-book, podcast, and
visual-novel directories to universal workflow bodies. Preserve shared clients/parsers, logical
provider identity, provider-scoped caches, search/details/resolve/translate contracts, canonical
language behavior, related-provider references, and exact script pinning.

Each network/config/cache/query call uses transparent durable host behavior. Remove obsolete
workflow/activity adapters discovered in these provider flows rather than recreating them. Update
provider fixtures and hermetic package/backend/E2E coverage in the same family batches; do not rely
on live upstream APIs.

## Acceptance criteria

- [x] All scoped provider entrypoints compile and execute through the universal runtime.
- [x] Search/details/resolve/translate outputs and logical provider provenance remain unchanged.
- [x] AniList anime/manga/person-independent shared client behavior remains deterministic; person
      providers are left for Task 12.
- [x] Provider-scoped cache sharing and user isolation remain intact across split entrypoints.
- [x] Shared implementation modules are reused without duplicated API clients or parsing logic.
- [x] No provider uses direct network access, ambient time/randomness, or detached Promise work.
- [x] Focused provider package tests and hermetic provider search/import/translation E2E pass.
- [x] Migration is delivered in a bounded family step while this task remains one owned slice.

## Completion Notes

- Routed provider scripts through `SandboxScriptWorkflow` when enqueued, while preserving active plugin
  resolution before exact workflow pinning and leaving non-provider scripts on their existing path.
- Routed provider details and translation calls through `SandboxExecutionService.executeScript` as
  deterministic child workflows, preserving user/system authority and existing result contracts.
- Reused the existing provider implementations and operation wrappers; no client or parser duplication
  was required because the scoped provider modules already used the role-preserving SDK definitions.

## Verification

- `bun turbo --filter=@ryot/media-plugin check`
- `bun turbo --filter=@ryot/media-plugin test`
- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/app-backend test`
- `bun turbo --filter=@ryot/tests check`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-import/entity-import.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-schemas/search-import.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-translation/entity-translation.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/plugins/plugins.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/cache.test.ts'`

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 8
- User story 13
