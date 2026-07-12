# Plugin-Owned Query Recipes

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Move domain query composition into the packages that own the referenced definitions. Read the
overview, Phase 4 plan, parent PRD, and this task first.

Media recipes, including the library membership filter used by media saved views, move into the
media package. Exercise, workout, measurement, and template recipes move into fitness. The generic
query package retains only domain-neutral primitives and application recipes required by generic
kernel services. Update package exports and every first-party/test consumer directly.

Do not keep forwarding re-exports, aliases, or deprecated paths from the query package.

## Acceptance criteria

- [ ] Every media-only recipe is owned and exported by the media package
- [ ] Every fitness-only recipe is owned and exported by the fitness package
- [ ] The generic saved-view builder has no `requireInLibrary`, `library`, or `in-library` vocabulary
- [ ] Media saved views preserve their canonical library filter through a media-owned wrapper or predicate
- [ ] Generic collection, entity, event, and interest recipes remain available without plugin imports in the kernel
- [ ] All production and test imports use the new canonical owners with no compatibility re-export
- [ ] Query document outputs remain structurally identical where behavior is unchanged
- [ ] Query-engine, media, fitness, backend, and affected e2e tests pass
- [ ] Domain recipe purity exceptions are removed

## User stories addressed

- User story 16
- User story 17
- User story 18
