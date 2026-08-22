# Client Plugin Contract

`@ryot-app/client-plugin-contract` owns schemas shared by plugin clients, the kernel, compiler, archive
tooling, and artifact persistence: bridge messages, artifact format and metadata, source file policy,
and shared capability payloads. Runtime-only policy stays with its runtime. Bridge payloads are
structured-clone values rather than JSON, so the upload source crosses the port as a `Blob`.

Artifact metadata includes content hash, artifact format, client API version, compiler version, and
bridge version. Bridge init establishes an immutable session identity from a random session ID and
that artifact identity. Ready repeats it, and the kernel accepts only an exact match. The plugin
reports metadata embedded in the artifact rather than treating echoed kernel input as proof.

The client artifact format, client API, compiler, and bridge protocol are currently exactly version 1.
They remain one coordinated greenfield boundary with no legacy decoder or compatibility adapter.

`ClientPageTarget` covers saved views, explicit plugin routes, and entities. Its page context carries
renderer identity, settings, optional named data sources, and route parameters. Artifact sessions are
scoped to the complete prepared client-page graph.

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
