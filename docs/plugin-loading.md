# Client-side Plugin Loading Performance Refactor

## Objective

Remove client-plugin build work, redundant authorization work, redundant network round trips, and unnecessary iframe bootstrap from normal navigation.

The target architecture is:

```text
plugin/catalog mutation
        ↓
determine compile identities
        ↓
compile missing immutable artifacts once
        ↓
publish new catalog/page state

normal navigation
        ↓
resolve page context
        ↓
lookup already-built immutable artifact
        ↓
issue/reuse artifact grant
        ↓
reuse existing iframe runtime where possible
        ↓
render
```

Normal navigation must never invoke the client-plugin compiler.

This work explicitly excludes:

- YouTube Music/provider search performance.
- Provider entity import/add-to-library latency.
- General sandbox execution performance.

The implementation should target the current `ultra-rewrite` architecture at commit `72440456f8e983954022b0e5a668f0fc42dbedcf`, not the older trace commit.

---

# Decisions fixed by this plan

## 1. Compilation is mutation-time infrastructure, not navigation-time work

`ClientPagesService.prepare()` becomes compiler-free and side-effect-free.

A missing artifact during preparation is an invariant/configuration failure. Preparation must never repair the state by compiling synchronously.

Compilation occurs when the inputs capable of changing a client artifact change:

- system plugin ingestion/update/removal;
- private plugin install/update/removal;
- plugin enable/disable/configuration transitions that change the effective client graph;
- user bootstrap after effective plugins and generated saved views exist;
- custom client renderer publication;
- any saved-view mutation that changes its renderer graph rather than only page settings/data.

Catalog invalidation must happen only after all newly required artifacts have been materialized.

## 2. Compiled artifacts are shared whenever their compiler inputs are identical

The current graph hash includes `pluginInstallationId`, even though installation ID does not affect `compilerInput`. This makes identical client code compile separately for different users.

Separate:

- **artifact identity**: everything affecting emitted bytes;
- **runtime/page identity**: authorization, installation IDs, saved-view revisions, operation targets, page context.

Artifact identity must not contain per-user installation IDs.

## 3. Same-artifact page navigation remounts page UI but reuses the runtime

All Movies → All Music should:

- keep the same iframe;
- keep the same loaded JS/CSS/fonts;
- keep the same bridge;
- keep the same Ryot client/runtime;
- replace the page context;
- remount the page-level React tree from a clean state.

Do not preserve component-local state or scroll position across different prepared page documents unless global browser navigation already restores it outside the plugin tree.

## 4. Existing update semantics remain

A currently open artifact may continue running until the user explicitly reloads it.

When catalog/plugin state changes:

- newly prepared pages use the new artifact;
- existing frames are checked for staleness;
- stale frames display the existing "Update available" state;
- there is no forced destructive reload.

Do not retain protocol compatibility with the old bridge. Bump the bridge protocol and change both sides atomically.

## 5. Saved-view URLs use saved-view slugs as their canonical navigation identity

`/v/:slug` already exposes a slug-oriented public URL. Standardize the client-page target and plugin navigation API on the slug rather than doing slug → ID → prepare as two sequential calls.

Internal persisted IDs remain internal DB identity.

---

# Phase 0 — Lock in the performance invariants

Do this as the first part of the same implementation. It is not separate pre-work.

Add tests/counters that establish the intended architecture before refactoring implementation details.

### Backend invariants

Add focused tests proving:

1. Calling `ClientPagesService.prepare()` can never invoke `ClientPluginCompiler`.
2. Two users with identical effective system-plugin client code resolve the same artifact graph/build.
3. Changing only `pluginInstallationId` does not change artifact identity or artifact graph hash.
4. Changing a source hash, selected export, route registry, automatic-presentation registry, compiler version, API version, or bridge version does change artifact identity where applicable.
5. User bootstrap materializes every client-page graph needed for the user's initial built-in views/workspaces.
6. Static artifact-file retrieval does not call `ClientPagesService.isIdentityCurrent()` or reconstruct source graphs.
7. Catalog invalidation occurs after required builds have been materialized.

Use recording/injected services rather than timing assertions.

### Client invariants

Add tests proving:

1. Switching between two documents using the same artifact does not create a second iframe.
2. It does not request a second artifact grant.
3. The page component remounts with the new `ClientPageContext`.
4. Page-owned shortcuts, overlay state, entity-interest subscriptions, header state, and screen state are reset on document replacement.
5. Switching to a different artifact creates/reuses the corresponding artifact runtime according to the three-runtime retention policy.
6. The initial catalog delivered by the authenticated route is not immediately refetched merely because the catalog SSE connection was established.

### Observability

Add backend spans or structured timings around:

```text
ClientPages.prepare
  resolve-target
  resolve-artifact-graph
  find-build
  issue-artifact-grant
```

Compilation gets separate mutation/materialization spans:

```text
ClientPageBuild.materialize
  resolve-graph
  load-source-files
  compile
  persist-artifact
  persist-build
```

Do not add permanent high-cardinality labels such as user IDs or full graph contents.

---

# Phase 1 — Split compile identity from runtime identity

## Contract changes

In `packages/contract/src/modules/client-pages/schemas.ts`, replace the current overloaded `ClientPageGraphIdentity` model.

Introduce a compile-only schema such as:

```text
ClientPageArtifactIdentity
```

It should contain only fields that influence compiler output:

- artifact format;
- client API version;
- bridge protocol version;
- compiler version;
- entry;
- selected exports;
- automatic presentation registry;
- kernel automatic fallback;
- compile contributors;
- route registry or an equivalent canonical representation if it affects generated output.

For plugin contributors retain compile-relevant fields such as:

- plugin ID where it affects namespaces/registries;
- plugin slug;
- source hash;
- namespace;
- exported client declarations;
- plugin dependency declarations.

Remove:

```text
installationId
```

from the artifact contributor identity.

Do not simply remove it from the current type and continue calling that type runtime identity. Create distinct types so future changes cannot accidentally reintroduce user-specific state into the artifact hash.

Runtime preparation continues carrying:

- current installation IDs;
- operation targets;
- saved-view ID;
- saved-view revision;
- renderer publication revision;
- plugin authorization/currentness information.

## Graph resolver

Refactor `kernel/backend/src/modules/client-pages/graph.ts` so it returns conceptually:

```ts
{
	(artifactIdentity, artifactKey, compilerInput, contributors);
}
```

`artifactKey` should be the deterministic hash of the canonical compile identity.

Do not call it a user graph hash after the refactor.

Ensure:

```text
same compiler input => same artifact key
```

is a tested invariant.

The compiler's own artifact hash remains the hash of emitted artifact contents. The artifact key identifies the requested compilation graph; the artifact hash identifies its emitted result.

---

# Phase 2 — Make client-page builds global and immutable

The existing `client_page_build` is user-scoped:

```text
user_id
graph_hash
graph_identity
artifact_hash
```

This is the wrong cache boundary.

Replace it with a global immutable mapping:

```text
client_page_build
  artifact_key PK
  artifact_identity JSONB
  artifact_hash FK plugin_client_artifact(hash)
  created_at
```

Remove:

- `userId`;
- random `buildId`;
- renderer ownership from the build cache;
- `(user_id, graph_hash)` uniqueness;
- update-on-conflict behavior.

An artifact build represents code, not authorization.

On conflict:

- read the existing row;
- assert that its stored identity and artifact hash agree with the requested artifact key;
- fail loudly on impossible hash/identity conflicts.

Do not overwrite an existing immutable build row.

Because there is no production data, rewrite the current migration/schema directly. Do not add a compatibility migration or data-copy bridge.

Also remove `buildId` from:

- `PreparedClientPageIdentity`;
- session/grant state;
- renderer publish response if no other consumer genuinely requires it;
- backend currentness checks;
- tests.

`artifactKey + artifactHash` are sufficient.

Review `clientRenderer.publishedArtifactHash`. If it is only duplicating the global build mapping after this refactor, remove it rather than maintaining two artifact authorities.

---

# Phase 3 — Extract a build materialization service

Create a dedicated backend service, for example:

```text
ClientPageBuildService
```

Its responsibilities are:

```text
resolve graph
→ find global build
→ single-flight missing compilation by artifactKey
→ compile
→ persist content-addressed artifact
→ persist immutable build mapping
→ return build
```

Move `inFlightCompilations` out of `ClientPagesService` into this service.

The single-flight map must use global `artifactKey`, so simultaneous users requesting materialization of the same code share one compilation.

`ClientPagesService` must stop depending on `ClientPluginCompiler`.

## `prepare()` after this phase

Preparation becomes:

```text
resolve current user/page target
→ derive artifact identity/key
→ find existing global build
→ construct PreparedClientPage runtime identity/context
→ issue artifact grant
```

No compiler.

No artifact persistence.

No build creation.

If the build is absent, return a distinct internal/invariant failure. Do not fall back to synchronous compilation.

---

# Phase 4 — Materialize artifacts at lifecycle boundaries

Introduce a generic orchestration port to avoid making the plugin module depend upward on `client-pages`.

For example:

```text
ClientSurfaceMaterializer
```

Define the interface at a dependency-neutral boundary and provide the real implementation from boot-layer composition.

It should expose operations along the lines of:

```text
materializeUser(userId)
materializeAffectedUsers(...)
materializeRenderer(userId, rendererId)
```

Exact API shape should follow the actual mutation call sites; do not create a generic event bus.

## User bootstrap

In `user-bootstrap/bootstrap.ts`:

Current ordering is approximately:

```text
provision installations
→ plugin bootstrap
→ ensure built-in saved views
→ mark bootstrap complete
```

Change it to:

```text
provision installations
→ plugin bootstrap
→ ensure built-in saved views
→ materialize required client artifacts
→ remaining bootstrap state
→ mark bootstrap complete
```

A user must never reach an authenticated client with bootstrap marked complete while required initial client artifacts remain unbuilt.

Materialize each unique artifact key once. Do not compile once per saved view.

## Plugin lifecycle

Before `PluginCatalogInvalidator.user(...)` or `.all` exposes new client state, materialize builds affected by:

- plugin installation;
- private plugin update;
- plugin uninstall;
- plugin enable/disable;
- configuration state transitioning a plugin to/from usable client state;
- shipped/system plugin ingestion/update/removal;
- conflict reconciliation that changes the effective client plugin set.

For system plugin changes affecting all users:

1. commit plugin/catalog state;
2. determine/materialize required unique artifact keys;
3. update any dependent generated saved-view state;
4. publish catalog invalidation only when the materialized state is usable.

Because the build table is global, N users sharing the same graph must not cause N compiler executions.

## Custom renderers

Renderer publication already compiles synchronously. Keep compilation there, but route it through `ClientPageBuildService` and global build persistence.

Publishing a renderer should fail if its artifact cannot be built. Once publication succeeds, preparation cannot encounter an unbuilt published renderer.

## Saved-view mutations

Settings, name, icon, layout preference and RyotQL data-source changes that do not alter code must not cause compilation.

A renderer change or a dependency change that produces a new artifact identity must materialize the target build before the changed view becomes visible to navigation.

---

# Phase 5 — Replace page sessions with reusable artifact grants

The current sequence is:

```text
prepare
→ HTTP response
→ createSession
→ currentness validation
→ Redis write
→ currentness validation again
→ HTTP response
→ load index.html
→ currentness validation again
→ load JS/CSS/fonts
→ currentness validation for every file
```

Delete this architecture.

## New preparation response

`prepare` should return the prepared page and its artifact grant together:

```ts
{
    context,
    identity,
    artifact: {
        hash,
        format,
        apiVersion,
        bridgeVersion,
        compilerVersion,
        grant: {
            src,
            expiresAt,
            grantId
        }
    }
}
```

Use naming consistent with the repository, but do not retain a second `createSession` operation.

## Artifact grant semantics

A grant authorizes one authenticated user to load one immutable artifact.

Redis state should contain only what static serving requires:

```text
userId
artifactHash
```

Do not store the entire `PreparedClientPageIdentity`.

Prefer reuse of an existing unexpired grant for:

```text
(userId, artifactHash)
```

so two saved views backed by the same artifact receive the same artifact URL.

Do not revoke grants merely because a frame was hidden or evicted. Let them expire naturally.

Delete:

- `CreateClientPageSessionBody`;
- `CreateClientPageSessionResponse`;
- `createSession` HTTP endpoint;
- corresponding client API method;
- client `ClientPageSessions.create`;
- frame-mount session creation logic;
- revoke-on-unmount behavior if it exists only for these short-lived artifact grants.

Rename the remaining session terminology to artifact-grant terminology rather than preserving old names.

## Static artifact serving

The artifact route should perform:

```text
validate token
→ load grant
→ obtain artifactHash
→ read artifact file
```

It must not:

- resolve the user's plugin catalog;
- reload plugin source files;
- rebuild artifact identity;
- inspect saved-view revision;
- call `isIdentityCurrent()`.

Authorization/currentness was established when the grant was issued.

## Caching

Artifact bytes are content-addressed and immutable.

Use cache headers appropriate for a private immutable resource, for example:

```http
Cache-Control: private, max-age=31536000, immutable
```

Keep the current CSP, referrer and MIME protections.

The stable/reused grant URL is important; changing the token every frame creation would defeat browser caching even with immutable headers.

Do not create a public unauthenticated artifact URL.

---

# Phase 6 — Separate artifact validity from page freshness

Do not make static resource serving responsible for checking whether a plugin changed after the frame loaded.

Replace the existing session-renewal/currentness mechanism with an explicit prepared-page freshness check.

When the plugin catalog invalidates:

```text
active frame
→ check prepared document identity
→ current: continue
→ stale: display existing "Update available" state
```

The freshness operation may compare:

- saved-view revision;
- renderer publication revision;
- plugin source hashes;
- current operation target installations;
- resolved artifact key.

This is an infrequent invalidation path, so correctness is more important than minimizing every DB read.

Do not run it for every JS/font/index request.

Remove the artifact-session renewal machinery from `PluginFrame` if it only exists to combine artifact-token expiry with page-currentness checking. Artifact-grant expiry and page freshness become two independent concepts.

---

# Phase 7 — Reuse one iframe runtime across compatible page documents

This is a breaking bridge change.

Increment `CLIENT_BRIDGE_PROTOCOL_VERSION`.

Do not add negotiation or old/new protocol branches.

## Frame identity

Change `ClientPageDocumentHost` from retaining three **page documents** to retaining three **artifact runtimes**.

Current effective key includes things such as:

```text
savedViewId
viewRevision
context digest
build identity
```

The new top-level frame key should be the artifact runtime identity, normally:

```text
artifactHash
```

If another immutable field genuinely changes bootstrap compatibility, include it explicitly.

All Movies and All Music backed by the same artifact should point to the same frame.

## Mutable document context

Add a bridge message representing document replacement, conceptually:

```ts
{
    type: "document",
    documentKey,
    page: ClientPageContext,
    navigation: ...
}
```

The initial bridge handshake may carry the first document as today. Subsequent same-artifact navigation updates the document without recreating the bridge.

On the plugin side:

- replace the immutable `const page = init.page` assumption;
- create a page-context store;
- make `usePageContext()` subscribe to it;
- update route resolution against the current page context;
- key/remount the page React subtree by `documentKey`.

Do not remount the entire SDK/runtime provider.

The following remain alive:

- iframe document;
- bundled JS;
- CSS/fonts;
- bridge;
- plugin Ryot client;
- theme connection;
- outer runtime infrastructure.

The page React tree is recreated cleanly.

## Reset page-owned state

On document replacement, clear anything scoped to the old page:

- page shortcuts;
- overlays;
- page header publication;
- plugin screen stack/readiness;
- page-owned entity-interest subscriptions;
- local route/page resolver state;
- pending page-local queries that should be aborted.

Do not leak state from All Movies into All Music.

## Retention

Keep the current memory bound of three, but redefine it as:

```text
at most three artifact runtimes
```

not three page documents.

Update `kernel/client/AGENTS.md` accordingly.

---

# Phase 8 — Make saved-view preparation a single server round trip

Current route:

```text
/v/$viewSlug
→ RyotQL loadRecord(slug)
→ get savedViewId
→ POST client-pages/prepare(savedViewId)
```

Delete this serial dependency.

## Canonicalize saved-view targeting on slug

Change:

```ts
{
	kind: ("saved-view", savedViewId);
}
```

at navigation/page-preparation boundaries to:

```ts
{
	kind: ("saved-view", slug);
}
```

Use the branded slug type if one exists or introduce one consistently.

Update:

- `ClientPageTarget`;
- plugin bridge navigation target;
- `RyotNavigationTarget`;
- `toGlobalHref`;
- client page preparation;
- plugin home-view client catalog representation where relevant.

Backend preparation resolves the slug to the saved-view row in the same request.

The prepared identity may still contain:

```text
savedViewId
viewRevision
```

for exact persisted identity/currentness checks.

## Saved-view route

Delete `SavedViewsService.loadRecord()` from the `$viewSlug` loader.

Call preparation directly with the route slug.

Use `PreparedClientPage.context` for:

- renderer type/name;
- saved-view settings;
- data sources;
- display name/icon;
- add-action decoding.

Use the route slug directly as the key for saved local layout preference.

If the prepared context lacks a piece of page metadata currently coming from `SavedViewRecord`, add that field to the preparation context rather than making another request.

Do not preserve both slug and ID navigation target variants.

---

# Phase 9 — Remove the plugin-route catalog reload

Current `$pluginSlug` loader does:

```text
load plugin catalog
→ find installation
→ derive target
→ prepare
```

while the authenticated parent has already loaded the catalog.

Refactor preparation targets so the route can send:

```ts
{
	kind: ("plugin-route", pluginSlug, path, search);
}
```

The backend resolves the current authorized plugin/installation and home-view mapping.

For display metadata in React, consume the already-hydrated `PluginCatalogProvider` rather than loading the catalog in the route again.

Delete:

```ts
PluginCatalogService.load(...)
```

from the child plugin loader.

Revisit `shouldReload: true`. Keep reload only where the target meaningfully changed. Do not force a plugin route loader refresh on every parent/router event.

---

# Phase 10 — Fix catalog connection refetching

`PluginCatalogEventsService` currently treats both:

```text
PLUGIN_CATALOG_CONNECTED_EVENT
PLUGIN_CATALOG_INVALIDATED_EVENT
```

as reasons to call `onCatalogChanged()`.

That means establishing the SSE connection can immediately refetch the catalog that the authenticated loader just fetched.

Change semantics:

```text
CONNECTED    → connection acknowledgement only
INVALIDATED  → increment invalidation revision + refetch catalog
```

The `PluginCatalogProvider` starts from the authenticated loader's catalog and performs no network catalog refresh until an actual invalidation event occurs.

Add a test explicitly asserting that a connected event causes zero query calls.

---

# Phase 11 — Keep intent preloading, but make it safe

Do not globally remove:

```ts
defaultPreload: "intent";
```

from the final architecture.

Intent preload was harmful in the trace because it could start a 10-second compiler job. Once `prepare()` is guaranteed to be:

- read-only;
- compiler-free;
- build-cache-only;
- relatively cheap;

intent preload becomes desirable.

Add an architectural test that client-page preparation has no compilation or persistence dependency. That is the guardrail that keeps hover/focus preload safe.

Do not leave a temporary "disable preloading because prepare is slow" workaround in the final tree.

---

# Phase 12 — Cleanup

After the new path works, aggressively delete the old architecture.

Remove:

- per-user `client_page_build` fields and APIs;
- `buildId`;
- installation IDs from artifact identity;
- compilation branches from `ClientPagesService.prepare`;
- compiler dependency from `ClientPagesService`;
- separate create-session endpoint;
- create/revoke session client APIs;
- full Prepared identity stored in artifact-session Redis state;
- graph-currentness checks on artifact-file reads;
- `cache-control: no-store` for immutable artifact bytes;
- page-document-keyed iframe reuse;
- immutable bridge page-context assumption;
- old saved-view-ID navigation target;
- saved-view record request from the page loader;
- plugin catalog request from `$pluginSlug` loader;
- connected-event catalog refetch;
- old protocol schemas and tests;
- compatibility aliases, adapters and version branching.

Update architecture documentation and `AGENTS.md` rules to describe only the resulting design.

---

# Required validation

Run the normal repository checks plus focused E2E coverage.

The final implementation should satisfy these observable outcomes:

| Scenario                                                             | Required outcome                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| First visit to a built-in saved view for a freshly bootstrapped user | No compiler process starts                                                       |
| Second user with the same system plugins                             | Reuses existing global build                                                     |
| All Movies → All Music when both use entity-browser                  | Same iframe and bridge remain alive                                              |
| Same-artifact switch                                                 | No artifact HTML/JS/CSS/font retrieval required after browser cache is populated |
| Saved-view navigation                                                | One preparation request; no preceding saved-view record request                  |
| Workspace/plugin navigation                                          | No child catalog fetch                                                           |
| Authenticated startup                                                | One initial catalog load; SSE connect causes no refetch                          |
| Artifact file request                                                | No plugin source loading or graph reconstruction                                 |
| Plugin update while page is open                                     | Existing page can show "Update available"; new navigation uses new artifact      |
| Intent preload                                                       | Never compiles or persists artifacts                                             |

After implementation, repeat only the representative browser trace used previously. This should be done by a human

The comparison should specifically inspect:

```text
Media Home → All Music
```

The old critical path contained:

```text
~8.66 s prepare
+ session creation
+ artifact boot
```

The new path should contain:

```text
cheap prepare/build lookup + artifact grant
→ existing/cached artifact runtime where applicable
```

Do not make wall-clock timing a unit-test requirement because environment latency varies. The hard regression criteria are architectural:

```text
0 compiler invocations during navigation
0 separate create-session RTT
0 duplicate saved-view-record request
0 duplicate child catalog request
0 iframe recreation for same-artifact page switches
0 graph reconstruction per static artifact file
```
