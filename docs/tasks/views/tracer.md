# Composable Views Tracer Plan

Status: implemented.

Read the [system design](./README.md) first. That document explains the intended system; this document defines the complete first implementation. Names introduced below are the target vocabulary. Derive implementation types from the canonical Effect schemas rather than copying the descriptive shapes in this document.

The [task index](./README.md#tasks) splits this plan into 13 implementation issues. Follow their stated dependencies; the ordered implementation steps below describe the larger checkpoints those issues deliver.

## Outcome

A user can save and publish reusable React source, create a saved view using it, and select that view as media home. The page combines public components from system media and fitness plugins with the user's private fixture plugin. It displays a mixed collection and grouped counts, performs a real multi-step collection mutation, refreshes without losing unrelated local state, and opens show and Pokemon detail pages through the shared runtime.

This must use the real new saved-view, compiler, artifact, SDK, and page paths. Do not implement a fixture-only composition shortcut. The dashboard source belongs to the user renderer, not the fixture plugin. The fixture owns only its public Pokemon UI, entity page, and existing private operation.

## User Stories

1. As a user, I can save, inspect, publish, and delete custom renderer source without a browser editor, so that I can build my own pages safely.
2. As a user, I can reuse one published renderer in several saved views with different settings, so that I do not maintain copied source code.
3. As a page author, I can import public components from system and privately installed plugins, so that a page can combine their capabilities.
4. As a user, I can navigate between saved views, plugin pages, and entity details through one page system, so that navigation stays consistent.
5. As a user, I can browse an ordered mixed collection and load later pages without rebuilding it, so that any supported entity type can appear naturally.
6. As a user, I can see useful show, workout, and Pokemon presentations with optional expanded detail, so that each domain shows the information it needs.
7. As a user, I can search, sort, count, change layout, and use a configured provider-add action without changing what my view means.
8. As a page author, I can display explicit table columns and independently keyed non-entity rows, so that query results are not forced into entity cards.
9. As a page author, I can use named row, aggregate, and time-series results, so that I can build dashboards without modifying system plugins.
10. As a page author, I can invoke an explicitly selected installed plugin operation through the SDK, so that its target does not depend on the current workspace.
11. As a user, I can choose a collection, review a Pokemon membership change, and confirm or cancel it, so that a multi-step page action performs a real authorized write.
12. As a user, I see result membership and summary counts refresh after a successful action, without losing unrelated local state.
13. As a user, I receive population, translation, and background-return updates through shared entity interest and refresh handling, without unnecessary work on inactive screens.
14. As a user, I can use pages and dialogs on mobile or in a narrow desktop area, with correct focus, scrolling, safe areas, and Back behaviour.
15. As a user, I receive a clear notice when page dependencies change and can reload when ready, without silent stale-code fallback or stale-revision writes.
16. As a user, I can choose a saved view as my workspace home and still open its normal saved-view URL.
17. As an implementor, I can run the complete demonstration and its tests with deterministic data using the existing fixture installation tools, without live provider credentials.
18. As a user, the existing backend access rules continue to protect my source and installations when an application contains several contributors.
19. As a user or maintainer, shipped views, backups, retained V1 imports, and documentation use the replacement system rather than an old-format adapter.
20. As a maintainer, I have one documented implementation without verified dead code or temporary transition paths, so that future changes do not maintain competing systems.
21. As a user, my authenticated settings screens stay as fresh as page screens, refreshing on return to the application and keeping displayed content when a refresh fails.
22. As a maintainer, kernel screens and plugin screens obtain data through one query/mutation surface with one cache, so that freshness and error behaviour cannot diverge between them.
23. As a plugin author, the supported client import surface is exactly one SDK surface, so that client code cannot reach the backend authoring surface by accident.

## Completion Checklist

- [x] Draft source can be saved, inspected, and successfully published through authenticated APIs.
- [x] Failed or racing publication does not replace published source.
- [x] Two saved views can reference the same custom renderer with different settings.
- [x] System and private plugin public exports compile into one application with one React root.
- [x] A later results page can introduce a new entity type without rebuilding or remounting the application.
- [x] Mixed results preserve query order and batch their presentation loading.
- [x] Show, workout, and Pokemon have distinct useful presentations.
- [x] Grouped collection counts reflect a confirmed membership change.
- [x] The named-query path accepts rows, aggregates, and time series without fake entity identities.
- [x] Fixture's `greet` runs against the private fixture installation, not media.
- [x] Collection creation/membership capabilities use authenticated kernel service paths through the SDK.
- [x] The collection dialog supports choose, review, confirm, retry, and Back dismissal.
- [x] The saved dashboard can render at media home without a duplicate frame or redirect loop.
- [x] Show and Pokemon entity routes use the shared page runtime and real provenance.
- [x] Population/translation refresh preserves an expanded row and unrelated form state.
- [x] Desktop, narrow containers, and mobile compact/safe-area behaviour are verified.
- [x] Dependency updates show a reload notice without immediately replacing an open page.
- [x] Existing artifact access rules cover composed dependencies through focused regression tests.
- [x] Shipped saved views use the new model; old slot contracts, runtime, and adapters are gone.
- [x] Authenticated kernel settings screens read and write through the shared query/mutation surface, with no route loader and no direct runtime call outside the documented exceptions.
- [x] Managed-asset batching and expiry exist once in the SDK and serve both the kernel and plugin callers.
- [x] Plugin `client/**` sources cannot import the plugin kit, and the client SDK Effect surface covers what client code needs.
- [x] Backups, retained V1 import code, fixtures, package guidance, and maintained documentation match the new model.

## Constraints

- All V2 code is open for refactor. Development data can be reset.
- Preserve backend entity storage and user authorization. Do not redesign either to solve presentation.
- No compatibility reader, old/new feature flag, stale-artifact fallback, or parallel saved-view runtime may remain at completion.
- No visual builder, browser source editor, renderer history, arbitrary npm dependencies, live executable module loader, or general live-query engine.
- No full media logging, workout editing, measurement editing, or general unsaved-form guard.
- Keep one active application iframe. Retain existing within-document screens, not a cache of hidden applications.
- API/tool authoring and workspace-home selection are sufficient; a new settings UI is not required.
- Use the existing fixture installation flow. Do not refactor `e2e/src/scripts/seed.ts`.
- Screens migrated onto the shared query surface lose route-loader prefetching. Accept the pending state; do not keep a cache-priming loader or add a second prefetch trigger to preserve `defaultPreload: "intent"` behaviour for them.
- Access decisions, redirects, and not-found signals stay in `beforeLoad`/loader. Only data acquisition moves. Pre-authentication routes and the token-scoped god-mode routes are permanent named exceptions, not deferred work.

## Existing Code And Ownership

These are the starting points, not constraints against moving code into its proper owner.

| Owner                 | Existing starting points                                                                                                  | Change                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| HTTP contracts        | `packages/contract/src/modules/saved-views`, `modules/plugins/manifest.ts`, `src/contract.ts`                             | New saved-view model, renderer authoring and page-session HTTP contracts, public exports               |
| Bridge contracts      | `packages/client-plugin-contract/src/index.ts`                                                                            | Page identity/context, explicit navigation/operation targets, collections, refresh, overlay state      |
| Backend saved views   | `kernel/backend/src/modules/saved-views`                                                                                  | Persistence, validation, builtins, cloning, navigation placement                                       |
| Definition registry   | `kernel/backend/src/modules/definition-registry/service.ts`, `modules/plugins/loader.ts`                                  | Validate/materialize new plugin definitions and public registrations                                   |
| Backend page services | New `kernel/backend/src/modules/client-pages`                                                                             | User renderer drafts/publication, dependency resolution, page preparation, artifact sessions           |
| Plugin lifecycle      | `kernel/backend/src/modules/plugins/runtime-resolver.ts`, `installation-service.ts`, `repository.ts`, `catalog-events.ts` | Supply effective contributors, source files, update signals, and installation-owned home setting       |
| Database/backups      | `kernel/backend/src/lib/infrastructure/db/schema/tables`, backend backup modules                                          | New source/build records, reference integrity, new backup shape                                        |
| Compiler              | `packages/client-plugin-compiler/src/compile.ts`, import/typecheck/style/artifact helpers                                 | Multi-contributor graph, generated bootstrap, deterministic styles/assets                              |
| Plugin packaging      | `packages/cli`, `packages/plugin-archive`, plugin host manifests                                                          | Validate public entries and package source, not precomposed user artifacts                             |
| Client page host      | `kernel/client/src/modules/plugins`, navigation shell and authenticated routes                                            | Reuse and generalize host/session/bridge services for page applications                                |
| Client SDK            | `packages/client-sdk/src/index.ts`, `runtime.ts`, `react.tsx`, `routing.tsx`, `entity-refresh.ts`, `effect.ts`            | Shared pages/presentations, refresh, explicit targets, collections, asset batching, host query context |
| Kernel screen data    | `kernel/client/src/routes/_authenticated/settings`, `modules/{integrations,imports,backups,settings}`, `api/*.ts` ports   | Move authenticated screen reads/writes onto the shared query/mutation surface                          |
| Kernel managed assets | `kernel/client/src/modules/assets/managed-assets.ts`, `managed-image.tsx`                                                 | Consume the extracted SDK asset behaviour; keep only the bridge adapter path                           |
| UI SDK                | `packages/client-ui-sdk/src/screen-frame.tsx`, overlays, table, sync components                                           | Standard page/browser UI and shared interaction behaviour                                              |
| Query recipes         | `packages/ryotql-recipes`, plugin `shared/` recipes                                                                       | General saved-view records, browser results, typed batched domain data                                 |
| Domain UI             | `plugins/media/client/show`, new fitness client entries, `plugins/fixture/client`                                         | Public presentations and pages                                                                         |
| End-to-end coverage   | `e2e/src/fixtures/kernel/client-plugin.ts`, `scripts/seed-client-plugin.ts`, API/browser suites                           | Reuse real installation, add deterministic tracer setup                                                |

Use Effect services for application I/O. Keep routes as adapters: routes still decide access and own redirects, but authenticated screen data flows through the shared query/mutation surface rather than route loaders. Each table has one writing repository; workspace-home writes go through the installation repository, and collection writes through the collection service. Do not create a new package merely to group these changes. Keep HTTP payloads in `contract`, bridge payloads in `client-plugin-contract`, author runtime in `client-sdk`, and visual primitives in `client-ui-sdk`.

## Fixed Contracts

### Saved View

Replace mandatory `layouts.grid/list/table` with these fields:

| Field                                                 | Meaning                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Existing identity/name/icon/order/disabled/timestamps | Preserve their user-facing purpose                                                                                      |
| `workspacePluginId: PluginId or null`                 | Navigation placement only; resolve input slugs against the user's installations                                         |
| `renderer`                                            | Tagged reference: `kernel` plus renderer name, `plugin` plus stable plugin ID/export name, or `custom` plus renderer ID |
| `settings`                                            | JSON object validated against the selected page's settings schema                                                       |
| `dataSources`                                         | One optional ordinary RyotQL document containing named queries; null means the page uses its own recipes                |
| Builtin provenance                                    | Existing generated/builtin ownership, kept separate from workspace placement and data provenance                        |

Kernel renderer names in this implementation are `entity-browser` and `results-table`. Do not add a renderer type for each possible chart. Plugin and custom pages can consume row, aggregate, and time-series sources.

Keep existing create/update/delete/clone/reorder routes and their ownership checks, but replace their payloads. Clone copies settings and sources while retaining the renderer reference, not the renderer source. Builtin page definitions remain plugin-owned; users can change supported placement/disabled/order state or clone them, not edit system code.

The server validates RyotQL documents through the existing validator. Do not retain the global one-query/rows-only/no-includes/entity-ID restriction. Renderer-specific checks apply only to the source used by the standard browser/table. Sources may contain additional queries. No stored source contains a continuation cursor; cursors belong to runtime requests.

Settings are JSON, not executable expressions. Use the existing declarative `AppSchema` validation for server-visible settings metadata. For this surface reject dynamic choices and upload fields; assets still work through SDK uploads and source files. React source decodes its own query results with Effect Schema and existing recipe helpers. The server never evaluates custom React to discover schemas or run validation.

### Custom Renderer

Create a user-owned renderer record containing ID, slug, name, timestamps, an integer draft revision, a draft definition, and a nullable published definition/hash. It has no backend sandbox scripts, entity definitions, or installation lifecycle: it is not a synthetic plugin.

A definition contains `entry`, `files`, `settingsSchema`, `pluginDependencies`, and `automaticEntityPresentations`. Use canonical `client/**` and `shared/**` source paths. HTTP file entries carry path and base64 content, normalized into the existing byte-file compiler input. Permit the same source/assets and supported imports as plugin clients; apply path, total-source, asset, and UTF-8 validation before storing. The draft may contain syntax/type/import errors, but not invalid paths, invalid base64, or oversized input.

`pluginDependencies` is a list of public plugin slugs. Resolve each to the current user's accessible stable plugin and installation IDs. A static public-plugin import must name a declared dependency. No private installation is selected by global slug alone. `automaticEntityPresentations` declares use of the automatic registry; it is not inferred from query rows.

Publication does not create a view. A view can reference only published custom source. Block renderer deletion while any saved view references it.

HTTP authoring surface:

| Method and route, relative to `/api`         | Input/result                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /client-renderers`                     | Name, slug, draft definition; returns owned draft record                       |
| `GET /client-renderers`                      | Lists owned renderer metadata and draft/published status, not all source bytes |
| `GET /client-renderers/:rendererId`          | Returns owned draft, published definition/hash, and revisions                  |
| `PUT /client-renderers/:rendererId/draft`    | Expected draft revision and replacement definition; increments revision        |
| `POST /client-renderers/:rendererId/publish` | Expected draft revision; returns published hash and validation build identity  |
| `DELETE /client-renderers/:rendererId`       | Deletes an unreferenced owned renderer                                         |

Use structured errors: `renderer-not-found`, `draft-revision-stale`, `renderer-unpublished`, `renderer-in-use`, `dependency-unavailable`, `export-not-found`, `definition-invalid`, `settings-incompatible`, and `build-failed`. Compiler diagnostics include contributor/export/path information only for code the caller may access.

Publication captures draft and dependency revisions, validates every currently referencing saved view against the candidate settings schema, and builds outside a database transaction. In one short transaction, recheck the draft, dependencies, and dependent-view settings before replacing the published definition. Reject a race; do not retry publication against a different draft silently. Dependent view create/update and publication must serialize their reference/settings checks through the renderer owner so neither can commit an incompatible reference. A successful publish leaves the draft intact. Concurrent view edits are not overwritten.

### Plugin Public Surface

Replace the plugin-authored bootstrap entry with a declarative client manifest. It contains:

- API version.
- Declared plugin dependencies by slug.
- `exports`: a map from stable local export name to kind, canonical client entry, and automatic-registry requirement.
- `routes`: existing local route patterns mapped to page export names; preserve a not-found page registration.
- `entities`: local owned entity-schema slugs mapped to an optional detail-page export and optional grid/list presentation exports.
- `homeView`: a plugin-owned saved-view slug, or null for no workspace home contribution.

An export kind is `page`, `component`, or `presentation`. Page exports carry declarative settings schemas. Each entry has one default export; generated compiler imports check its kind against SDK types. Components may have ordinary typed React props. A presentation uses the SDK definition described below. Entry modules do not call `createRoot` or bootstrap the runtime. Only the generated application entry does that.

Public import spelling is `@ryot-app/plugins/<pluginSlug>/<exportName>`. The compiler resolves this virtual path from the authorized contributor graph. Reject undeclared plugins, missing exports, traversal, backend files, arbitrary packages, and cross-contributor relative paths. Relative imports remain local to their contributor. Preserve the narrower existing rules for `shared/**`.

A plugin registers automatic presentation only for its own schema. There is one chosen presentation per owner/schema/layout, not a priority contest between plugins. A custom page can explicitly import a different component when it wants different behaviour.

The generated application can start from a plugin route registry or from a saved-view renderer. Plugin route applications include their own registered pages so existing within-plugin screen retention still works. Renderer applications include the selected page export and its import graph. These are different build entries using the same bootstrap and runtime, not different execution systems.

### Client Source Import Policy

Contributor `client/**` sources import exactly one Ryot authoring surface: the client SDK and UI SDK entry points, plus React, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `clsx`, public plugin exports, and contributor-local relative paths. The plugin kit is the backend and shared authoring surface; remove it from the client trusted-module set so `TRUSTED_MODULES` no longer inherits the neutral shared modules. `shared/**` keeps its existing narrower plugin-kit-only rule, and a shared file imported from client code is still checked under the shared rule, because classification follows the importer.

Widen `@ryot-app/client-sdk/effect` to the namespaces the compiler's Effect shim already provides, so client code never needs the plugin kit to reach them. The shim, the pinned `effect/*` resolver, and this re-export must name the same set; a namespace missing from any one of the three is a compile-time or runtime hole rather than a graceful degradation. Client sources continue importing `Schema` through the SDK subpath; a bare `effect` import stays untrusted.

Type visibility currently does not distinguish shared from client sources, because the semantic check builds one flat path map for the whole virtual project. Bundler-level rejection is the enforcing mechanism for this rule. Record that limitation rather than splitting the type project in this tracer.

### Page Context And Identity

The kernel resolves a page target before preparing its application. Targets are `saved-view` by ID, `plugin-route` by stable plugin ID/path/search, or `entity` by entity ID. Workspace-home resolution produces a saved-view target while preserving the workspace URL/context.

The bridged page context contains target identity, renderer identity, settings, optional named data sources, route inputs, workspace context, and history index/key. Keep theme, compact mode, safe-area values, readiness, and title ownership on their existing validated channels.

SDK page hooks expose settings, data-source definitions, and route context. A page export receives this common context; domain code derives specific settings/query-result types from schemas. Backend services validate stored settings, and runtime decoding failures become page errors rather than unchecked property access.

Do not put a page's settings, entity ID, search text, or data results into executable source or artifact hashing. Hash source, public export metadata that affects code, resolved contributor revisions, automatic-provider membership, and compiler/runtime versions. A changed settings schema is part of the published source definition; a changed setting value is not.

### Host Query Context

The React query and mutation surface is the shared async-state layer for both environments; the client capability object is not the only thing it may reach. Give the provider an optional host-supplied services value and pass it to query and mutation definitions alongside the existing client, input, and signal. Plugin applications supply nothing and reference nothing; the kernel supplies its Effect runtime so kernel screens run ordinary services inside the same cache, revalidation, and refresh machinery.

This exists so the capability object stays the bridge contract. Do not add kernel-only categories such as settings, integrations, imports, backups, or administration to that object: the plugin adapter cannot supply them, every such method would answer `unsupported-capability` inside a plugin, and host REST concerns would become plugin-visible surface. Capability categories are added when they are genuinely shared, as collections are.

Remove the existing workaround that reaches the same effect by passing a runtime through a query's input value, because runtime identity then participates in query-input identity and cache membership. Host services belong to the provider, not to an input.

The provider owns one registry and cache per client identity. Construct the kernel client once per API scope rather than inside a route loader, so a loader re-run cannot mint a new client identity and silently discard the query cache. A stable client also removes the parent-match plumbing that exists only to borrow a loader-created client.

Active-screen state is part of this contract. Its default is active and only the plugin router currently supplies it, so every kernel screen is permanently active. The kernel must own that state for its own screens before kernel queries declare entity interest, otherwise inactive kernel screens keep contributing demand.

## Standard Results And Loading

### Browser Configuration

`entity-browser` settings identify a named rows source, projected entity ID/plugin owner/schema fields, enabled layouts, default layout, explicit search fields, allowed sort choices, optional table columns, and an optional add action. The source must project real entity provenance and one result per entity. Verify entity-ID/provenance projection origins, not just aliases named `entityId`.

The browser uses that one source for selection across grid/list/table. Table display fields can be additional projections in the same source. An explicit search field names a projected expression to search; a sort choice names projected expressions and directions. Apply only declared choices to a cloned request document and add a deterministic primary-key tie-breaker. Never infer search from the title or first column. Changing search/sort resets cursor and count state, but switching layout does not change membership.

Expose search, existing page-size/load-more behaviour, count-on-demand, layout selection, refresh, and existing loading/empty/error/sync states. A basic control for declared sort choices is sufficient. Arbitrary filter editing remains out of scope; fixed filters live in the query and custom pages can supply their own controls. Do not carry forward non-functional Filters buttons.

Persist layout preference using existing server/user/view-scoped client storage. Explicit URL layout/search/sort inputs win over stored/default values. Preserve non-browser search parameters used by a page's dialogs.

The add action is explicitly `provider-search` with an entity-schema owner/slug, or absent. Preserve the existing provider-add flow through a semantic SDK screen request handled by the kernel. The host pushes URL-owned add state and renders the existing kernel modal above the iframe; make the underlying iframe inert. Import completion closing the flow requests one page refresh. Mixed views do not get a provider-search action by inference.

The separate `results-table` kernel renderer accepts a named rows source, explicit columns, a nonempty tuple of projected scalar row-key fields, and an optional entity-link mapping. Encode row keys with stable JSON including value types; reject null/missing or duplicate keys within a page. Rows referring to the same entity remain distinct when their row keys differ. It does not require entity provenance unless entity navigation is configured.

Entity browser row keys are entity IDs. Query shapes that multiply an entity within a page fail clearly instead of silently dropping meaningful rows. Across cursor pages, keep stable-key overlap handling and do not invent new identities. Count distinct selected entities for the browser; do not reuse that count rule for general rows. Aggregates/time series retain their actual wire shapes and do not enter browser pagination.

Table formats are explicit text, date, number, boolean, JSON, or managed asset. Reuse general formatting and table primitives, not the old slot types. Null preserves an empty table cell. Layout-specific formatting must not rewrite selection queries.

### Entity Presentations

Introduce `defineEntityPresentation` and `EntityResults` in the client SDK author surface, with visual implementations in the UI SDK where appropriate. `EntityResults` accepts ordered entity references, grid/list layout, and JSON view context. It selects entries from the generated automatic registry. It does not perform selection or sorting.

An entity reference contains entity ID, nullable owner plugin ID, and entity-schema slug, derived from the query's canonical schema. Resolve automatic entries by owner identity plus local slug, not slug alone.

A presentation definition has a batch loader and a React component. The loader receives the SDK client, AbortSignal, and a list of entity references of that presentation. It returns decoded data keyed by entity ID. The component receives one entity reference, its decoded data, and view context. Generic type helpers infer the data type from the loader; do not maintain a second handwritten mirror of the response schema.

Group by exact presentation export/layout and use stable sorted IDs as batch input, while preserving original order for rendering. Chunk root IDs at 100, respecting existing RyotQL limits. Schedule at most four background presentation/asset batches concurrently so ordinary list loading does not exhaust the bridge's 64 pending requests. Cancel obsolete batches; ignore stale completion; deduplicate the same provider/input across consumers through existing query hooks.

The loader must not silently return records outside its request. Missing requested entities show an item error/not-found state. A batch failure affects that batch, not other providers. Each item has a React error boundary and retry/basic entity-link fallback. Explicit component import/build failures do not become automatic fallbacks.

Provide a kernel-owned fallback loader/presentation using common entity identity/name/schema information and existing sync fields. It must not guess `properties.images` or media/fitness field names. A missing automatic presentation uses this fallback; it is a normal new renderer, not compatibility code.

View context includes originating saved-view ID and optional collection ID only when explicitly supplied. Do not extract collection identity from an arbitrary query AST. Components can use the same presentation outside a saved view.

### Queries, Assets, And Refresh

Extend existing `createRyotQuery`/`useRyotQuery`, not a parallel query framework. Active query consumers register their refresh handles with the active screen. Add `usePageRefresh` for custom loading callbacks and a page-refresh request on the page API. Use existing input identity and cached-success behaviour.

Emit a mutation-completed hint at the SDK capability boundary after a successful plugin operation or collection write, whether or not it was called through `useRyotMutation`. Deduplicate at that boundary so a hook does not trigger a second invalidation. Refresh every registered query on the active page, including selection, counts, and widgets. Read-only plugin operations may also refresh; do not add operation classification in this tracer. Upload allocation alone is not a domain mutation signal.

Combine refresh requests with the existing short batching window, allow one refresh per query/input at a time, and retain a pending hint if changes arrive during a request. Failed mutations do not issue success hints. Mutations completing after navigation refresh the currently active page and mark retained inactive query state stale for its next activation; do not refetch hidden screens.

Re-query selection from the first page through the previously loaded page depth, following newly returned cursors. Re-run grouped summaries independently. Keep displayed data on refresh failure and report the error. Clear obsolete count state. Stable keys preserve row expansion and sibling dialogs. An initial source failure still uses an explicit error branch.

Reuse the existing entity-interest aggregation, foreground/visible distinction, limits, and settle handling. Ensure foreground priority is preserved before applying the total-ID cap at both runtime and kernel layers. Use viewport intersection for list item visibility, with the shared page scroll root; loaded offscreen results are not all foreground work. Expanded detail data can request additional foreground interest. Inactive screens release active interest. Do not add provider quotas or a new subscription protocol.

Extract media's generic managed-asset batching/expiry behaviour into the SDK. Retain domain-specific asset collection in domain code. Use existing 64-locator request limits, deduplicate locators, retain resolved values during refresh, refresh expiring URLs, and preserve placeholder behaviour. No caller obtains bearer credentials.

The kernel is the second caller of that extracted behaviour, not an exception to it. It currently resolves managed assets through its own service in a route loader, threads a URL map through view state and three layers of props, discards the expiry value it already receives, and never refreshes an expired URL; it also keeps its own locator-key, locator-collection, URL-resolution, and image-wrapper duplicates of what the plugin implements. Kernel screens and renderers consume the extracted behaviour and those duplicates are deleted. The kernel-side asset service remains only where it serves the bridge adapter's asset requests on behalf of a plugin session.

Any visual component that moves into `client-sdk` as part of this extraction must be reachable by the artifact stylesheet scanner. The scanner currently reads plugin client sources and the UI SDK only, so utility classes written in `client-sdk` reach a plugin artifact only when some scanned file happens to use the same class. Either add the client SDK to the scanned sources or keep visual implementations in the UI SDK and leave only hooks and data behaviour in `client-sdk`. Do not rely on incidental class overlap.

Kernel app activation/visibility changes produce one shared refresh hint; deduplicate it with existing query focus refresh. Expose the signal through the existing bridge lifecycle rather than relying only on visibility inside the iframe. Do not introduce continuous polling.

## Builds, Publication, And Sessions

### Resolve The Contributor Graph

Use the backend's effective plugin resolver for the current user. Persist references by stable plugin identity. Public import slugs are resolved within this scope and verified against declared dependencies. Obtain source bytes through the plugin repository, not an unauthenticated source endpoint.

Walk selected entries and public imports recursively with cycle-safe graph traversal. When any selected export requests automatic presentation, include all registered automatic grid/list providers from compatible, ready, enabled installations available to the user, plus the kernel fallback. Repeat dependency expansion until the graph is complete. This registry is fixed for that build, not based on first-page data.

Existing disabled-plugin behaviour remains: disabled plugins are excluded from automatic discovery and workspace discovery, but direct routes and explicit dependencies can resolve an otherwise ready installed plugin. Missing, installing, failed, or incompatible explicit dependencies fail preparation. Missing automatic providers use the fallback. A currently eligible export that fails compilation fails the build with a named diagnostic; do not silently suppress broken code.

The automatic-provider set fingerprint participates in build identity, including provider export metadata and revisions. A later page cannot add executable code. Installation/removal/enable-state/export changes that alter this set make the open page need an update.

Do not block removal of a private plugin merely because an arbitrary custom renderer declares it. Existing entity/reference removal rules still apply. If removal is otherwise allowed, the dependent view becomes explicitly unavailable until edited. Never resolve a different installation as a silent substitute.

### Compile And Cache

Generalize the existing client compiler input to a selected application entry, contributor file maps, resolved public-export map, automatic registry, and application metadata. Namespace virtual files per contributor so equal relative filenames do not collide. Resolve React, SDK, and UI SDK to singleton trusted modules across all contributors.

Generate the only bootstrap/root and typed imports of selected exports. Typecheck the reachable source graph and generated imports. On plugin packaging/install, validate all advertised exports and routes, including unreachable ones, using generated validation entries. Do not execute contributor modules in the backend process to discover exports or settings.

Support multiple reachable contributor stylesheets. Remove the current one-stylesheet-per-complete-artifact restriction. Resolve asset URLs relative to each contributor, reject external/traversal imports under existing policy, deduplicate content-addressed assets, and emit styles in a deterministic dependency/source order. Emit Tailwind, fonts, theme, palette, and global SDK rules once using existing theme precedence. Document that contributor selectors share a document; preserve scoped class conventions rather than promising CSS isolation.

Keep current compiler limits: concurrency 2, 30-second compilation timeout, 512 KiB submitted reachable source, 256 KiB per asset, 8 MiB artifact, and 1 GiB supervised memory. Count authored reachable source across all contributors, excluding compiler-owned bootstrap/trusted dependencies. Fail clearly if exceeded; do not enlarge limits just to hide an accidental full-plugin graph.

Store immutable artifacts using the existing artifact/file tables generalized away from a mandatory single-plugin pointer. Add a build lookup keyed by the resolved source/graph/runtime fingerprint. It records the authorized subject and dependency metadata needed to validate reuse. Byte storage may deduplicate identical content; possession of a hash is not permission to obtain a session.

Publication builds immediately. Page preparation reuses an exact valid build or compiles on demand. Coalesce concurrent requests for the same build in the service process; database uniqueness handles duplicate work across processes. Capture input revisions, compile outside transactions, and recheck before committing/reusing a result. Do not add a durable build queue or retry loop. Catalog events invalidate build selection; they do not eagerly build every user view. A failed build is retryable and does not become a stale-code fallback.

### Page HTTP And Session Contract

Add these authenticated routes through the page service:

| Route                                          | Behaviour                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `POST /client-pages/prepare`                   | Resolve target, settings, graph, and build; return prepared identity/context and artifact metadata        |
| `POST /client-pages/sessions`                  | Recheck prepared identity and user access, then create the existing style of short-lived artifact session |
| `POST /client-pages/sessions/:token/renew`     | Renew only for the owning user and a still-current build/dependency set                                   |
| `DELETE /client-pages/sessions/:token`         | Revoke under the existing ownership behaviour                                                             |
| `GET /client-pages/artifacts/:token/:fileName` | Token-authorized immutable artifact file serving                                                          |

The session stores user, target/renderer identity, build hash, and all exact code-contributor installation/source identities, replacing the single-plugin payload assumption. Revalidate current access and dependency freshness when issuing/renewing/serving. Retain existing token lifetime and no-bearer-in-iframe behaviour. Do not add authenticated headers to iframe file loads or claim token URLs are safe to share.

Prepared identity includes view/published-source revisions for race checks, but runtime settings are not artifact bytes. A prepare/session race returns a structured stale-preparation error; the kernel can resolve again before mounting, without showing a different artifact as the requested one.

Replace old single-plugin session endpoints/callers rather than leaving adapters. Existing direct plugin pages prepare their application through this same service. Retire obsolete plugin-row `clientArtifactHash`/catalog assumptions in favour of public client availability and prepared page artifacts; audit provider/query projections, backups, tests, and CLI validation that currently read that field.

### Open-Page Updates

An accepted session/document identity stays attached to its mounted host until explicit navigation/reload or an actual fatal failure. Do not key the host directly from every new catalog value as today.

Catalog/source publication changes compare the open page's entry, code dependency set, and automatic registry with current state. Show a kernel-owned update notice, stop renewing stale sessions, and do not forcibly remount an already-loaded document just because renewal reports staleness. A loaded document may keep its in-memory UI, but cannot fetch stale artifact files after serving checks reject them. Distinguish this state from a broken bridge or logout, which still disposes the host.

Reload is explicit and warns that local unsaved work will be discarded. It prepares a current build and replaces the document. If building fails, show the current build error with retry; do not silently restore an old artifact. Settings/context changes for the same renderer may update the active page instance without recompiling; React reconciliation still follows the kernel history identity.

## SDK Authority And Navigation

### Explicit Targets

Change operation invocation to require `pluginSlug`, operation slug, input, and the existing output decoder. Add explicit plugin identity to route navigation, and a saved-view target alongside existing entity targets. Do not infer the target from the current workspace or from the entry contributor. Update all first-party and fixture callers; no default implicit-plugin adapter remains.

The kernel resolves targets to the current user's installations. For code contributors, operation invocation uses the source revision recorded in the build/session. For other installed operation targets, record their accessible source revisions in the session's routing context when mounting; these are routing metadata, not executable dependencies or a new permission grant. Require reload to use a newly installed target. Reject a target whose recorded revision is no longer current; never substitute a different revision after a stale error. The backend remains the final authority. A target not included as code does not cause its client files to be bundled.

Update the bridge schema, host dispatcher, direct SDK adapter, generated typings, and tests together. Move title/drawer/page controls through the existing screen/navigation surface, not arbitrary native methods on the data client.

### Collections

Add a narrow kernel `CollectionsApi` port over existing contract routes, then SDK methods for collection creation, membership upsert, and membership removal. Derive input/output from the existing collection contract. Read collection choices through RyotQL recipes, not a second listing API. The tracer only needs membership creation, but expose the existing cohesive collection mutation surface rather than direct contract escape hatches.

The bridge carries semantic validated payloads; the kernel supplies authentication. Preserve existing upsert behaviour so retrying a confirmed membership request does not duplicate it. Abort/cancel before confirmation does not write. A network error after confirmation may have committed server-side; allow retry through the idempotent upsert and do not claim that closing a dialog rolls back a submitted operation.

### Home Selection

Store a nullable `homeSavedViewId` on the user's plugin installation. Add `PUT /plugins/:pluginSlug/home-view` with `{ savedViewId: id or null }`. Validate that the target saved view belongs to the user, is enabled, and references a usable published/registered renderer. Permit a global or differently placed view; workspace placement is not renderer ownership.

Null uses the plugin's declared default home view. Deleting/disabling an override clears or invalidates the preference and falls back to that default. Build failure of an existing override shows its error rather than quietly changing dashboards. Guard defaults against recursive home references: a home view selects a renderer, not another home target.

The authenticated loader/navigation data includes the effective home selection through the existing shared navigation load. `/:pluginSlug` remains the home URL and active workspace. `/v/:viewSlug` also opens the same view directly with its ordinary placement context. Never mutate loaded sidebar data in place.

### Back, Dialogs, And Screen State

Preserve history index/key reconciliation, the existing bounded retained-screen stack, compact edge gestures, safe areas, theme updates, and active-title ownership. One visible page owns its frame and scroll root. No nested `<main>`/header inside an entity item.

Add a small page-search update API for merged push/replace updates to the current URL, preserving unrelated search keys. The tracer uses `dialog=add-to-collection` and `entityId` as URL state. Opening pushes, closing pops if opened locally, and direct-entry closing removes these keys with replace. Choose/review state stays in the dialog's React state; browser Back closes the dialog rather than moving between steps.

Existing UI SDK React-state overlays inside an iframe need a document-level back adapter. Aggregate overlay presence and advertise it to the kernel; hardware Back and explicit SDK Back first dismiss the top eligible overlay through an acknowledged bridge request. Use one outstanding request with a bounded failure path. Suspend edge-back ownership while an overlay owns Back. Preserve LIFO ordering with kernel-owned overlays above the iframe. Browser Back cannot be intercepted by this mechanism; dialogs requiring browser Back semantics use pushed URL state, as the tracer does. Do not build general form-leave interception.

Opening a plugin/entity route outside the current application may replace the iframe. Preserve local state only where the existing retained-document model actually applies. No new cross-document scroll/state cache. A background data refresh must never act like route navigation.

Standard page components expose refresh and optional conventional chrome. Custom pages choose their content. Continue bridging compact mode and safe-area values; use container-responsive component layouts inside that outer mode. Test keyboard/focus/scroll behaviour in the collection dialog and reduced-motion Back behaviour through existing primitives.

## Domain And Demo Specification

### Public Components

| Contributor | Export/registration                                | Required behaviour                                                                                                                                |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media       | `show-card`, `show-row`, existing show detail page | Poster when available, name, year/status, useful episode/progress information from stored data, entity navigation; no new logging workflow        |
| Fitness     | `workout-card`, `workout-row`                      | Name, start date, duration from start/end, useful stored exercise/set summary when present, expandable details; no image well for image-free data |
| Fixture     | `pokemon-card`, `pokemon-row`, `pokemon-page`      | Artwork, type badges, expandable abilities/height/weight, entity navigation                                                                       |
| Fixture     | `pokemon-picker` component                         | Query owned accessible Pokemon and open the reusable add-to-collection flow for a selected entity                                                 |
| Fixture     | Existing `greet` operation                         | Deterministic private operation result through an explicit fixture target                                                                         |

Keep recipes and their decoders with the owning plugin's shared/client query module. Do not move domain calculations into the kernel. For workouts, derive duration from existing start/end data and use actual schema-backed set/exercise data if shown. Do not create persisted summary fields solely for this demo. Unknown data is omitted or marked unavailable, not replaced with fabricated values.

Use ordinary public components in plugin pages as well as the dashboard so reuse is real. Register Pokemon entity detail, not only the existing fixture local `/details/$itemId` demonstration route. Preserve the fixture's useful existing upload/theme/asset/navigation checks while removing obsolete bootstrap assumptions.

### User-Owned Dashboard

Store the demonstration renderer source as an E2E-owned source fixture and publish it through the new API. Its settings schema contains a collection ID and a page-size setting bounded by the existing row limit. It uses typed recipe inputs, not new RyotQL parameters.

The page contains a standard frame, collection counts grouped by schema owner/slug, `EntityResults` for the paginated collection, the imported fixture Pokemon picker, and a small explicit `greet` check. Display labels come from known provider metadata rather than unqualified schema-slug guesses. The page registers both selection and summary queries for refresh. Its automatic-registry declaration ensures that media, fitness, and fixture presentations are built in.

Seed a show, a workout, Pokemon A, Pokemon B, and a collection. Initially the collection contains show, workout, and Pokemon A in a deterministic order. Pokemon B starts outside it. Use page size two for the pagination assertion, so fixture presentation first appears on page two. The picker can select Pokemon B regardless of collection membership.

Selecting Pokemon B opens the dialog. Step one selects the seeded collection, step two reviews Pokemon and collection, and confirmation performs the membership upsert. On success close the URL-owned dialog and refresh once through the shared mechanism. The total changes from three to four, Pokemon count from one to two, and the new item appears after loading the necessary page. Verify persistence after reload.

Create a second saved view referencing the same published renderer with another collection setting. This proves source reuse without another custom build for settings alone. Select the primary dashboard as media home through the new API and verify both media home and its direct saved-view URL.

### Deterministic Setup

Extend `e2e/src/scripts/seed-client-plugin.ts` and the existing fixture helpers. Retain its real fixture build/install and revision-A/revision-B update demonstration. Print the custom view and media-home URLs in addition to existing credentials. Do not add another installer.

Use existing typed test-support operations and production service paths to seed media, fitness, Pokemon, collections, and memberships. Fixtures live under their owning plugin/kernel trees; source for the user dashboard belongs to kernel page-test fixtures and imports plugin exports just as a user would. Use hermetic provider fixtures or existing supported population paths for completion tests. No direct SQL row mutation and no live PokeAPI/TMDB dependency in automated tests.

## Ordered Implementation Steps

Each step includes tests for its behaviour. Intermediate commits may be incomplete during development, but the finished tracer must contain only the replacement path. Do not preserve temporary dual-runtime scaffolding as a supported mode.

### 1. Publish And Open A User Page

Implement custom renderer contracts/storage, draft revision checks, settings validation, publication, a single-contributor form of the new compiler entry, page prepare/session routes, and the generalized host. Open a minimal user React page through a new-format saved view. Add the generated single bootstrap and page context. Use kernel page primitives from the SDK, not direct kernel imports.

Tests: draft save without compiling; successful publish; syntax/type failure leaves publication unchanged; stale draft/dependency commit rejection; reference/settings race; unauthorized renderer lookup; unpublished reference rejection; exact prepared-identity session checks; one root and page frame in the browser.

Completion: an API-created user page builds and opens through the intended runtime, without a fixture special case.

### 2. Compose Public Plugin Exports

Implement client manifest export metadata, virtual public imports, authorized graph resolution, singleton dependencies, multiple contributor CSS/assets, and build fingerprinting. Convert plugin page bootstraps and explicit navigation/operation targets. Reuse existing show detail, add Pokemon detail, and adapt existing fixture demo pages. Add automatic-provider graph expansion and update notices.

Tests: one public component from system media and one from private fixture in a user page; repeated dependency deduplication; equal local file names do not collide; undeclared/private-file imports rejected; unrelated page code excluded; CSS and assets from multiple contributors emitted correctly; source/provider-set changes change build selection; settings values do not; failed current build never serves stale code; open dialog survives update notice; stale contributor operations rejected.

Completion: ordinary plugin/entity pages and composed pages share one host/bootstrap/SDK implementation, with no implicit operation target.

### 3. Replace Saved-View Selection And Presentation

Implement new source/settings validation, entity browser, general results table, typed named-result loading, explicit search/sort, stable identities, pagination/counting, standard add action, automatic presentation loaders, and generic fallback. Add media show, fitness workout, and fixture Pokemon presentation exports. Extract reusable managed-asset behaviour. Convert shipped saved-view definitions as their affected renderers become available.

Tests: mixed order preserved while batches complete out of order; bounded loader calls rather than per-card detail fetches; later page introduces fixture with no rebuild; layout changes preserve selection/search; obsolete request results ignored; arbitrary table rows sharing an entity remain distinct; invalid duplicate keys fail; aggregates and time series decode through the named-source path; no-image workout has no reserved poster region; missing automatic renderer differs from a broken explicit import; item failure stays local; provider-add behaviour remains URL-owned.

Completion: the normal saved-view route, not a bespoke dashboard list, can render mixed entities through the new system.

### 4. Complete Refresh And The Real Action

Add the collections port/SDK bridge and shared mutation-completed refresh. Extend existing query hooks with active-screen registration and arbitrary callback support. Connect background hints and entity-interest refresh. Implement the fixture picker and URL-owned choose/review/confirm dialog, plus the minimal shared overlay Back adapter. Publish the actual user-owned demo renderer through test setup.

Tests: correct private `greet` target; collection upsert uses kernel authorization; cancellation before submission does not write; failed submission preserves selection and permits retry; confirmation updates selection and grouped count; duplicate success hints do not double-refresh; an event during a request schedules subsequent refresh; errors keep displayed data; inactive screens do not refetch; entity completion updates display without collapsing a row; removed/unmounted interests are released; foreground IDs survive capping ahead of visible IDs.

Completion: the displayed action persists real state, and every affected widget changes through the common refresh path.

### 5. Connect Workspace Home And Verify The Journey

Implement installation-owned home selection, update shared navigation loading, and render the selected view at the workspace URL. Extend the existing manual fixture seed/update script. Cover navigation into show/Pokemon detail, direct dialog entry, browser Back, native Back dispatch, and narrow/mobile layouts. Verify two views reuse one published source with different settings.

Tests: home override is user-owned and nullable; deletion/disable fallback; build failure remains visible; no redirect loop/duplicate frame; global history remains authoritative; direct-entry dialog close uses replace; pushed dialog close uses pop; kernel overlays win over iframe overlays; same-document retained state stays intact; crossing documents makes no false restoration guarantee; compact/safe-area inputs and narrow desktop columns work; update notice does not discard dialog state.

Completion: the seeded user can follow the complete demo from media home without hand-editing database rows or relying on browser-only mocks.

### 6. Unify Kernel Screen Data Access

Implement the host query context and active-screen ownership, then move the authenticated kernel settings screens off route loaders and direct runtime calls onto the shared query/mutation surface. Construct the kernel client once per API scope and remove the parent-match plumbing. Tighten the client source import policy and widen the SDK Effect surface. Keep access decisions, redirects, and not-found signals on the router.

Tests: host services reach a kernel query without entering query-input identity; a re-run access check does not discard cached query state; a settings write refreshes its own screen's data through the shared mechanism rather than a router invalidation; refresh failure keeps displayed content; an inactive kernel screen releases entity interest; a client source importing the plugin kit is rejected with a named import diagnostic while the same import from a shared source still compiles.

Completion: kernel and plugin screens share one query surface, one cache, and one refresh model, and the plugin client import surface is exactly the client SDK and UI SDK.

### 7. Remove Old Paths And Finish Documentation

Finish converting all media/fitness/fixture saved-view definitions, navigation queries, backup shapes, generated client contracts, and retained V1 import output. Remove obsolete slot mappings/decoders, per-layout query controllers, single-plugin session endpoints, old authored bootstrap code, and dead catalog artifact-pointer logic. Preserve useful generic formatting, query builders, interaction primitives, and assertions; relocate rather than duplicate them.

Generate database/route/client outputs using their existing tools. A reset is allowed; do not hand-maintain old JSON compatibility. Write the new backup format/version and fixtures together and reject unsupported old V2 backups explicitly. Retained V1 migration code should target new shipped views directly; it is a V1 import feature, not permission to preserve the removed V2 format.

Update backend/client/SDK/compiler/contract/plugin-kit READMEs and the maintained user/plugin documentation in `apps/docs`. Replace obsolete stable rules in affected AGENTS files, especially saved-view slot rules, single-plugin host identity, compiler import/style rules, and bootstrap/version rules. Keep rationale in READMEs, not AGENTS files.

Several packages carry a `CLAUDE.md` that is a byte-identical mirror of its sibling `AGENTS.md`; every rule change lands in both files or the mirror silently contradicts the rule. Named stale rules include the kernel client's instruction to load route-defining data in a loader, the media plugin's documentation of plugin-local managed-asset batching and expiry as the contract, the media rule pinning its own asset image wrapper, and the compiler's verbatim trusted-import allowlist. The client SDK capability documentation must also name the complete error-reason set, including the reasons no document currently mentions, so the taxonomy is discoverable without reading the source.

Perform the mandatory final cleanup using the `codebase-cleanup` skill over touched files and directly affected callers. Verify removals against manifests, compiler import allowlists, runtime registrations, backups, migrations, fixtures, and generated outputs. Do not delete unrelated code just because static searches show no local caller.

Completion: no old/new compatibility path remains; the complete acceptance suite passes; documentation describes implemented behaviour and clearly identifies deferred features.

## Testing And Validation

Test application decisions, races, and visible behaviour. Do not add tests of schema-library internals, TypeScript assignability, or passthrough wrappers. Keep domain recipe result schemas/decoders/types colocated. Use package assertion helpers and inline intent assertions.

Use existing suites as prior art:

- Artifact access and invalidation: `e2e/src/api/kernel/plugins/client-artifact.test.ts` and backend artifact-session/repository tests. Adapt them to the generalized session and add one composed-private-dependency regression; do not create a separate security workstream.
- Plugin source/update: backend plugin installation/service tests and `e2e/src/fixtures/kernel/client-plugin.ts`.
- Query refresh: `packages/client-sdk/src/react.tsx` tests, `entity-refresh` tests, media `show/queries.test.tsx` and `refresh-state.test.tsx`.
- Navigation/Back: kernel `-plugin-navigation.test.tsx`, SDK routing/stack tests, host tests, and UI SDK frame/overlay tests.
- Saved-view behaviour: kernel `-saved-view.test.tsx`, recipe tests, and existing saved-view API/browser suites; rewrite expectations to the new model rather than simply deleting coverage.
- Collection persistence: `e2e/src/api/kernel/collections/memberships.test.ts`.
- Kernel screen data access: existing kernel route tests such as `-settings-integrations.test.tsx`, `-settings-import-data.test.tsx`, and `-settings-backups.test.tsx`; rewrite their expectations onto the shared query surface rather than deleting the coverage.
- Client import policy: `packages/client-plugin-compiler/src/compile.test.ts`, including its trusted-module assertions and its shared-source-imported-from-client fixture, which must keep compiling.

Add focused integration files for renderer publication and the complete browser journey, under `e2e/src/api/kernel/client-pages/renderer-publication.test.ts` and `e2e/src/browser/composed-views.test.ts`. Extend existing artifact tests for new dependencies instead of copying their ownership cases. Keep private fixture/domain setup in the existing ownership-separated fixtures.

Use isolated compilation tests for source graph, missing exports, CSS/assets, build identity, and singleton runtime behaviour. The compiler must typecheck emitted entry imports and tests must execute emitted JavaScript for the bootstrap/composition boundary, not merely assert that a bundle string exists.

The browser journey must observe one iframe containing system and private components, perform the persisted mutation, load the later page, navigate to both entity owners, and return to a valid view. Separate focused tests prove state preservation during refresh/update and overlay Back behaviour. Seed two users only for the focused existing-access-rule regression, not every visual test.

At least one runtime test supplies nonzero bridged safe-area values and compact mode, and one browser test uses a mobile viewport plus a narrow desktop container. Native software-keyboard and hardware-Back behaviour also receive a manual smoke check when a simulator/device is available; report unavailable native verification rather than claiming browser automation covers it.

Run relevant package unit tests and checks as each step lands. Final package set includes contract, client-plugin-contract, client-plugin-compiler, client-sdk, client-ui-sdk, ryotql-recipes, CLI, kernel backend/client, media, fitness, and fixture. Use the actual workspace package names from their manifests when forming focused Turbo filters.

Known commands from the repository:

```bash
bun turbo --filter=@ryot-app/fixture-plugin build
bun turbo --filter=@ryot-app/fixture-plugin check
bun turbo --filter=@ryot-app/client-plugin-compiler test
bun turbo --filter=@ryot-app/client-sdk test
bun turbo --filter=@ryot-app/kernel-client test
bun turbo --filter=@ryot-app/kernel-backend test
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/client-pages/renderer-publication.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/plugins/client-artifact.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/browser/composed-views.test.ts'
```

Run affected standard E2E files separately for final acceptance, following `e2e/README.md`. Do not enable the live-provider smoke or large operational gate for this tracer without a separate reason. Do not increase worker counts, timeouts, or database pools to hide failures. Package `check` scripts apply formatter/linter fixes; inspect their resulting diffs and preserve unrelated work.

## Final Review Questions

- Is the demo source actually stored and published as a user renderer?
- Are system and private components using exactly the same public-export and SDK paths?
- Can a later page introduce a new plugin type without losing the user's current state?
- Do settings changes reuse executable code while source/dependency changes produce a new identity?
- Does a confirmed collection change refresh both membership and aggregate data?
- Can the page remain open on an update notice without permitting stale-revision writes?
- Are ownership, title, Back, focus, and mobile signals still kernel-controlled where required?
- Have old slots, implicit plugin targets, and single-plugin artifact adapters been removed rather than hidden?
- Do kernel screens and plugin screens reach data through one query surface and one cache, with host services supplied by the provider rather than smuggled through a query input?
- Does managed-asset batching and expiry refresh exist once, with the kernel as an ordinary caller?
- Is the plugin client import surface exactly the client SDK and UI SDK, with the plugin kit reachable only from shared sources?
- Can a fresh implementor run the seed script and tests without live provider credentials?

Any unmet item is unfinished tracer work, not a reason to leave a permanent compatibility path.
