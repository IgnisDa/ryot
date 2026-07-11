# Media Recipe Migration

**Parent Plan:** [RyotQL](./README.md)

**Status:** todo

## What to build

Rewrite every remaining media-owned query recipe and production consumer directly in the RyotQL SDK. Preserve the useful data access and output behavior of show details, show progress states, podcasts, suggestions, trending data, relationship projections, and other media reads while removing migrated imports of legacy query-engine builders and documents.

Media-only recipes remain owned by the media plugin. Use normal discriminator predicates, JSON paths, safe casts, explicit joins, includes, correlated expressions, aggregates, and time series as applicable. Do not create an old-to-new translator, copy legacy source concepts, or move plugin-only recipes into the shared recipes package. Migrate each media consumer and focused test together so no production media path is partially translated.

## Acceptance criteria

- [ ] Every production media recipe not migrated by the monitoring slice builds a RyotQL document directly
- [ ] Media-only recipes remain in the media plugin and depend on the generic RyotQL SDK rather than legacy primitives
- [ ] Show, season, episode, podcast, suggestion, trending, progress, relationship, JSON, and analytical reads preserve their consumed fields, filters, ordering, nesting, and pagination
- [ ] Query documents use normal table joins and discriminator predicates with no schemas, via, attached source, property selector, or schema metadata concepts
- [ ] Media sandbox consumers use executeRyotql and strict RyotQL response helpers where they execute query documents
- [ ] Shared application recipes are used only when they are genuinely cross-application
- [ ] Focused media recipe, saved-view-definition, sandbox, workflow, and end-to-end tests pass against RyotQL
- [ ] Repository checks find no production media imports or calls to legacy query-engine APIs after this task
- [ ] Non-media legacy consumers and the complete legacy engine remain green
- [ ] Media documentation references RyotQL where query behavior is described

## User stories addressed

- User story 5
- User story 6
- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 12
- User story 13
- User story 14
- User story 23
- User story 28
- User story 29
- User story 33
- User story 34
