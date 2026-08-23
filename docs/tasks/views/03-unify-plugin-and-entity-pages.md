# Unify Plugin And Entity Pages

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** todo

**Depends On:** [02 - Compose Public Plugin Components](./02-compose-public-plugin-components.md)

## What To Build

Open ordinary plugin routes, the existing show detail page, and a new Pokemon entity detail page through the same page preparation, generated bootstrap, host, and SDK used by user saved views. Keep their global URLs and provenance rules.

Follow [Plugin Public Surface](./tracer.md#plugin-public-surface), [Page Context And Identity](./tracer.md#page-context-and-identity), [Explicit Targets](./tracer.md#explicit-targets), and the navigation portions of [Back, Dialogs, And Screen State](./tracer.md#back-dialogs-and-screen-state).

Replace authored `bootstrapClientPlugin` calls with registered page exports and generated bootstrapping. Entity routes still load actual provenance and choose the schema owner's page. Do not create a saved-view record per entity or add user overrides for entity detail pages. Preserve useful fixture upload, theme, assets, and navigation demonstrations.

Introduce explicit plugin route and operation targets throughout the existing SDK/bridge call sites. The operation capability must retain source-revision validation; Task 07 exercises it together with the new collection workflow. Add page-context and merged page-search navigation support for later URL-owned dialogs.

Preserve history index/key reconciliation, bounded within-document screen retention, active title/readiness ownership, compact mode, safe areas, and existing edge gestures. No hidden-application cache or new cross-document state restoration.

## Acceptance Criteria

- [ ] Existing plugin routes and custom saved views enter the same host/bootstrap/session implementation.
- [ ] `/e/:entityId` selects the correct show or Pokemon page from real provenance, not the currently active workspace.
- [ ] Pokemon has an entity-page registration, not just the fixture's local demonstration details route.
- [ ] Missing entities, unavailable owners, disabled direct installations, and unregistered entity pages follow explicit route branches.
- [ ] Public page modules do not mount their own application roots.
- [ ] Route and operation calls identify their target plugin explicitly; existing callers no longer depend on a current-plugin default.
- [ ] Page-search updates merge specified keys and preserve unrelated query parameters.
- [ ] Global history and within-document retained screen state continue to work using kernel history index/key.
- [ ] Titles, frame ownership, compact mode, safe-area values, and reduced-motion behaviour remain correct.
- [ ] Moving across application documents makes no unsupported promise to preserve arbitrary form or scroll state.
- [ ] Routing, bridge, host, and browser tests cover system and private entity navigation through the shared path.

## Verification

Adapt existing kernel plugin-navigation, SDK routing/stack, host, and browser client-plugin tests. Reuse the show screen rather than redesigning it. Keep Pokemon data loading in fixture-owned query code so Task 05 can reuse it in presentations.

## User Stories Addressed

- [User story 4](./tracer.md#user-stories): consistent plugin/entity/view navigation.
- User story 10: explicit operation targeting.
- User story 14: preserve shared mobile screen behaviour.

## Implementor Notes

Record any runtime/bridge format changes and generation commands. Do not leave implicit-plugin adapters after converting callers.
