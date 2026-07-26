# Migrate Books and Serial Media Providers

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

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

- [ ] All scoped provider entrypoints compile and execute through the universal runtime.
- [ ] Search/details/resolve/translate outputs and logical provider provenance remain unchanged.
- [ ] AniList anime/manga/person-independent shared client behavior remains deterministic; person
      providers are left for Task 12.
- [ ] Provider-scoped cache sharing and user isolation remain intact across split entrypoints.
- [ ] Shared implementation modules are reused without duplicated API clients or parsing logic.
- [ ] No provider uses direct network access, ambient time/randomness, or detached Promise work.
- [ ] Focused provider package tests and hermetic provider search/import/translation E2E pass.
- [ ] Migration is delivered in bounded family commits/steps while this task remains one owned slice.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 8
- User story 13
