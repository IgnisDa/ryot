# Client pages and compositions

Client-page preparation resolves a saved view, plugin route, or entity against the current authorized
catalog. Preparation and freshness use the same read-only home and route selection. Preparation
reuses an immutable composition by key and materializes it on a miss; freshness only finds an
existing composition. A hit does not inspect artifacts or rebuild the manifest. Preparation does not
compile plugin source.

Dependency aliases belong to the importing manifest. Compiled imports carry scoped package IDs
and export names; graph preparation checks their declarations, exact targets, exports, and cycles.
Composition maps and contributor bindings use local plugin IDs, never metadata names or slugs.
Page context carries each contributor's package ID, local ID, revision, and installation. These
nonsecret bindings support explicit SDK recipe selection in a shared realm, not module isolation.

Plugin routes use `/p/<publisher>/<name>`. Saved views use `/v/c/<id>`, `/v/k/<slug>`, or
`/v/p/<publisher>/<name>/<slug>` according to their tagged reference. Quarantine removes executable
contributors; freshness checks never replace them with another package.

Saved-view preparation reads `user_saved_view_effective`: custom views are user-owned rows,
while built-in content comes from current definitions and optional per-user visibility and
order overrides. The effective definition and override revision participate in freshness
checks without copying built-in content into every account.

A composition combines compiled client artifacts (shared runtime, kernel renderers, and plugin
modules) with an immutable, content-addressed manifest. The manifest records the import map's file
references, bootstrap, selected page or route exports, and automatic presentation registry. Shared
runtime files retain the same artifact URLs across compositions; modules are not copied into each
composition. See [page bundles](../bundles/README.md) for the install trust boundary,
image-hash visibility rule, and static-file serving policy.

`POST /api/pages/prepare` returns page context, identity, and composition hash and versions.
`POST /api/pages/document` takes a prepared identity and repeats the freshness resolution
for the authenticated user. It generates the document from the composition that resolution
selects, never from a client-sent hash alone, and answers a stale or unauthorized identity with
`ClientPageDocumentStale`. The document is structured data: title, import map, preload plan,
composition metadata, page descriptor, and bootstrap URL. The client renders it into a sandboxed
`srcdoc` iframe, so no capability URL is ever a frame's document URL. Successful files at
`/api/page-bundles/:artifactHash/:accessKey/*` are immutable with a public cache for image-owned
hashes and a private cache for capability-protected hashes. All compiled code uses this one asset
route, independent of plugin ownership. Each document request issues reusable 15-minute artifact
grants for private hashes; preparation issues none.

Eager code is preloaded in the document. Public automatic-presentation-only artifacts load on
demand. Authorized automatic-presentation artifacts are warmed while the grants are valid, but their
presentations are evaluated only on demand. The client retains up to three iframe runtimes keyed by
`compositionHash`. When a prepared page uses an existing composition, a document message replaces
its page context and remounts the page tree without recreating the iframe, bridge, or SDK runtime.
