# Client Plugin Contract

`@ryot-app/client-plugin-contract` owns schemas shared by plugin clients, the kernel, compiler, archive
tooling, and artifact persistence: bridge messages, artifact format and metadata, source file policy,
and shared capability payloads. Runtime-only policy stays with its runtime. Bridge payloads are
structured-clone values rather than JSON, so the upload source crosses the port as a `Blob`.

Artifact metadata includes content hash, artifact format, client API version, compiler version, and
bridge version. Bridge init establishes a runtime identity from a random bridge session ID and the
composition hash and version metadata. Ready repeats it, and the kernel accepts only an exact match.
The iframe reports metadata embedded in the composition document rather than treating echoed kernel
input as proof. Later document messages replace the page context and remount its page tree without
closing the bridge. The kernel retains up to three iframe runtimes by composition hash.

The client artifact format and client API are version 1; the Vite-based client compiler identity is
version 2 and the bridge protocol is version 3.

`ClientPageTarget` covers saved-view slugs, explicit plugin routes, and entities. Its page context
carries renderer identity, settings, optional named data sources, and route parameters. Authenticated
HTTP preparation returns a document grant; document rendering issues private artifact grants. Neither
grant crosses the bridge in page context.

Installed plugin archive client executables are trusted. Archive validation checks integrity and
compatibility, not provenance. Image-owned artifact hashes are public; all other hashes require a
capability regardless of plugin scope. Compiled code uses one static URL form,
`/api/client-assets/:artifactHash/:accessKey/*`. Compositions reference immutable artifacts; the
capability-bound HTML document is generated separately and is not cached.

Entity interest uses strict state messages with at most 500 selected IDs: plugins send foreground and
visible IDs, and the kernel sends entity ID plus `populated` or `translated`. These messages have no
request IDs, acknowledgements, tickets, credentials, user identity, or server fields. The shared
declaration schema is uncapped; runtimes own aggregation and bounded selection.

The complete public `RyotClientErrorReason` set is `disposed`, `protocol`, `transport`,
`asset-failed`, `collection-failed`, `query-failed`, `invalid-input`, `operation-failed`,
`malformed-result`, and `unsupported-capability`.

Reserved kernel shortcuts are semantic bridge messages, not public `RyotClient` capabilities. Raw
keyboard events never cross the boundary. Page shortcuts are declarative and two-way: a document
registers modifier-free keys from `PAGE_SHORTCUT_KEYS` upward, and the kernel sends a press message
back down. Both realms register the same keys, so whichever document holds focus sees the press.

This package derives specialized fields from generic HTTP-contract schemas such as entity IDs, JSON,
RyotQL documents, and asset locators. The dependency remains one-way: `@ryot-app/contract` must not
import this package.
