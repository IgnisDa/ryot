# Publish And Open Custom Pages

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** done

**Depends On:** None

## What To Build

Let a user save a custom renderer draft, publish it, create a saved view referring to it, and open the page through the real compiler, artifact session, and sandboxed host. The page may be simple, but the entire path must be production code rather than a fixture-only shortcut.

Implement the contracts in the parent plan's [Saved View](./tracer.md#saved-view), [Custom Renderer](./tracer.md#custom-renderer), [Page Context And Identity](./tracer.md#page-context-and-identity), and [Page HTTP And Session Contract](./tracer.md#page-http-and-session-contract) sections. Start with a source graph containing only the user contributor and trusted SDK dependencies; Task 02 adds public-plugin graph resolution. Do not invent a separate single-contributor format that later needs an adapter.

Add owned renderer storage, source validation, authenticated draft/publish/delete APIs, and draft revision checks. Capture source before compiling, compile outside database transactions, and atomically check revisions and dependent-view settings before publication. Use the new saved-view renderer/settings/data-source shape, not the old layout fields.

Generalize the compiler bootstrap and client host sufficiently to prepare and open this page. Keep one React root, validated artifact metadata, existing iframe isolation, and kernel-owned page identity. Reuse current compiler limits and artifact storage/access rules. No source editor UI is required.

Construct the kernel client once per API scope rather than inside the authenticated route loader, as [Host Query Context](./tracer.md#host-query-context) requires. The provider owns one registry and cache per client identity, so a loader-created client silently discards cached query state whenever that loader re-runs, and routes currently borrow it through parent-match plumbing that exists only for that reason. Fix this before anything depends on the shared cache; Task 11 completes the rest of that contract.

Primary code areas are the contract, backend `client-pages` and `saved-views` modules, database schema, client compiler/bridge, SDK page context, and the saved-view route. Follow the parent ownership table for exact starting points.

## Acceptance Criteria

- [x] The documented renderer authoring APIs create, list, inspect, replace drafts, publish, and delete owned renderers.
- [x] Invalid syntax can be saved as a draft, while invalid paths, malformed file encoding, and oversized source are rejected before storage.
- [x] Successful publication builds the captured source and makes it available to saved views without modifying the draft.
- [x] Failed compilation or stale draft publication leaves the previous publication unchanged.
- [x] Reference/settings checks serialize correctly with publication and view changes; no incompatible reference wins a race.
- [x] Unpublished renderer references and deletion of referenced renderers fail with the documented structured errors.
- [x] A user can create two views using the same published source with different settings, without generating different executable code solely for those settings.
- [x] Opening the view uses the new prepare/session contract, one sandboxed iframe, one React root, and one visible page frame.
- [x] The kernel client is constructed once per API scope, a loader re-run does not create a new client identity or discard cached query state, and no route borrows a loader-created client through parent-match plumbing.
- [x] A changed preparation identity is rejected rather than silently opening a different build.
- [x] Source and session ownership checks reuse backend authorization; no bearer credential is sent into the page.
- [x] Focused API, compiler/bootstrap, and browser tests prove this working path.

## Verification

Use the parent plan's [Testing And Validation](./tracer.md#testing-and-validation) conventions. Add the initial `renderer-publication.test.ts` API suite and a minimal opening assertion to `composed-views.test.ts`. Exercise emitted application JavaScript rather than only checking bundle text. Do not require installed fixture exports or live providers for this first path.

## User Stories Addressed

References are to [User Stories](./tracer.md#user-stories) in the parent plan:

- User story 1: edit and publish source.
- User story 2: reuse source with different view settings.
- User story 18: preserve the existing user access boundary.

## Implementor Notes

Record any schema generation commands and the final source/build identity fields here. Do not use this section to defer acceptance criteria to later tasks.

- Generated `kernel/backend/src/drizzle/20260906153031_opposite_scarlet_witch` with `bun run db:generate` from `kernel/backend`.
- Published source identity records `rendererId`, integer `publishedRevision`, and canonical-definition `publishedHash`.
- Build identity records `buildId` and immutable `artifactHash`; settings and data sources do not participate in artifact identity.
- Preparation identity additionally records `savedViewId` and its monotonic integer `viewRevision`. Artifact sessions persist this complete identity and recheck it before renewal or file access.
- Verified all affected package checks and the focused compiler, backend, client, API E2E, and browser E2E suites. The browser test switches between two views that share one renderer and confirms a new page context in one sandboxed iframe.
