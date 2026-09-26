# Client pages and compositions

Client-page preparation resolves a saved view, plugin route, or entity against the current authorized
catalog. It looks up an already materialized composition and issues a reusable document grant; it
does not compile code or rebuild the composition on navigation. System compositions are materialized
at boot, and affected user compositions are materialized when their inputs change. A separate
freshness check compares a prepared page with current catalog state.

Saved-view preparation reads `user_saved_view_effective`: custom views are user-owned rows,
while built-in content comes from current definitions and optional per-user visibility and
order overrides. The effective definition and override revision participate in freshness
checks without copying built-in content into every account.

A composition combines compiled client artifacts (shared runtime, kernel renderers, and plugin
modules) with an immutable, content-addressed manifest. The manifest records the import map's file
references, bootstrap, selected page or route exports, and automatic presentation registry. Shared
runtime files retain the same artifact URLs across compositions; modules are not copied into each
composition. See [client artifacts](../client-artifacts/README.md) for the install trust boundary,
image-hash visibility rule, and static-file serving policy.

`POST /api/client-pages/prepare` returns page context, identity, composition hash and versions, and
a document grant URL. `GET /api/client-pages/documents/:token` resolves that grant to its user and
composition, then generates HTML with an import map, page descriptor, and artifact access URLs.
Document grants and artifact grants are distinct, reusable 15-minute capabilities. The HTML is
dynamic and `private, no-store`; successful files at
`/api/client-assets/:artifactHash/:accessKey/*` are immutable with a public cache for image-owned
hashes and a private cache for capability-protected hashes. All compiled code uses this one asset
route, independent of plugin ownership. The document request issues artifact grants for private
hashes; preparation issues only the document grant.

Eager code is preloaded in the document. Public automatic-presentation-only artifacts load on
demand. Authorized automatic-presentation artifacts are warmed while the grants are valid, but their
presentations are evaluated only on demand. The client retains up to three iframe runtimes keyed by
`compositionHash`. When a prepared page uses an existing composition, a document message replaces
its page context and remounts the page tree without recreating the iframe, bridge, or SDK runtime.
