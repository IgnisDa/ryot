# Unify Plugin And Entity Pages

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** done

**Depends On:** [02 - Compose Public Plugin Components](./02-compose-public-plugin-components.md)

## What To Build

Open ordinary plugin routes, the existing show detail page, and a new Pokemon entity detail page through the same page preparation, generated bootstrap, host, and SDK used by user saved views. Keep their global URLs and provenance rules.

Follow [Plugin Public Surface](./tracer.md#plugin-public-surface), [Page Context And Identity](./tracer.md#page-context-and-identity), [Explicit Targets](./tracer.md#explicit-targets), and the navigation portions of [Back, Dialogs, And Screen State](./tracer.md#back-dialogs-and-screen-state).

Replace authored `bootstrapClientPlugin` calls with registered page exports and generated bootstrapping. Entity routes still load actual provenance and choose the schema owner's page. Do not create a saved-view record per entity or add user overrides for entity detail pages. Preserve useful fixture upload, theme, assets, and navigation demonstrations.

Introduce explicit plugin route and operation targets throughout the existing SDK/bridge call sites. The operation capability must retain source-revision validation; Task 07 exercises it together with the new collection workflow. Add page-context and merged page-search navigation support for later URL-owned dialogs.

Preserve history index/key reconciliation, bounded within-document screen retention, active title/readiness ownership, compact mode, safe areas, and existing edge gestures. No hidden-application cache or new cross-document state restoration.

## Acceptance Criteria

- [x] Existing plugin routes and custom saved views enter the same host/bootstrap/session implementation.
- [x] `/e/:entityId` selects the correct show or Pokemon page from real provenance, not the currently active workspace.
- [x] Pokemon has an entity-page registration, not just the fixture's local demonstration details route.
- [x] Missing entities, unavailable owners, disabled direct installations, and unregistered entity pages follow explicit route branches.
- [x] Public page modules do not mount their own application roots.
- [x] Route and operation calls identify their target plugin explicitly; existing callers no longer depend on a current-plugin default.
- [x] Page-search updates merge specified keys and preserve unrelated query parameters.
- [x] Global history and within-document retained screen state continue to work using kernel history index/key.
- [x] Titles, frame ownership, compact mode, safe-area values, and reduced-motion behaviour remain correct.
- [x] Moving across application documents makes no unsupported promise to preserve arbitrary form or scroll state.
- [x] Routing, bridge, host, and browser tests cover system and private entity navigation through the shared path.

## Verification

Adapt existing kernel plugin-navigation, SDK routing/stack, host, and browser client-plugin tests. Reuse the show screen rather than redesigning it. Keep Pokemon data loading in fixture-owned query code so Task 05 can reuse it in presentations.

## User Stories Addressed

- [User story 4](./tracer.md#user-stories): consistent plugin/entity/view navigation.
- User story 10: explicit operation targeting.
- User story 14: preserve shared mobile screen behaviour.

## Implementor Notes

Record any runtime/bridge format changes and generation commands. Do not leave implicit-plugin adapters after converting callers.

- Client page preparation accepts saved-view, plugin-route, and entity targets. Entity preparation resolves persisted schema provenance and the owning plugin's registered detail-page export.
- Plugin-route builds generate one manifest-backed route registry and one compiler-owned `bootstrapClientPlugin` call, so route changes retain the iframe, history-keyed screen stack, and shared SDK runtime. Selected saved-view and entity pages use the compiler-owned `bootstrapClientPage` entry.
- Authored media and fixture bootstraps were removed. Media registers its home and show detail pages; fixture registers home, full-bleed, details, not-found, and Pokemon detail pages while preserving its existing demonstrations.
- Bridge protocol version 2 requires explicit plugin-route and operation targets and adds merged page-search updates. Compiler version 3 invalidates artifacts built before the generated route registry and selected-page runtime changes.
- Preparation identities record exact operation target revisions separately from executable contributors. The host snapshots them for the accepted document so updates fail stale until an explicit document reload rather than silently substituting a revision.
- Static route segments sort ahead of dynamic segments in backend matching and generated client routing. Dynamic route parameters are decoded into page route context.
- No schema or route generation command was required. Verified the focused renderer-publication, artifact-access, and client-plugin browser E2E files, all non-E2E package tests, and the complete repository check.
- Follow-up: tests inject dependencies through Effect instead of mocking. `packages/client-sdk` schedules every
  delay and clock read through a `Clock`-backed `RyotScheduleService`; `RyotProvider` takes a `ManagedRuntime`
  rather than a bare client, and `useRyotSchedule` is the plugin-facing accessor. `TestClock` replaces fake timers,
  and it governs SDK scheduling only, never `AtomRegistry` idle-TTL or `Atom.swr` staleness.
- Follow-up: `@ryot-app/client-sdk/testing` now owns the bridge bootstrap harness, so plugin page tests drive the
  real `bootstrapClientPage` handshake instead of stubbing SDK modules. Media sandbox automations report non-fatal
  push failures through the `log` host capability, changing those persisted run-history entries from a bare
  `[warn] ` string to a structured, redacted entry that also reaches the kernel logger.
- Fixed here: `PreparedClientPageTarget` listed `PluginClientPageTarget.members[0]` (the bare entity variant)
  instead of `members[1]`, so `plugin-route` was missing from the prepared union and `kernel/client` did not
  typecheck at 6f4c0906be.
