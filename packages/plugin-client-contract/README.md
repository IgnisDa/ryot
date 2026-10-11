# Client Plugin Contract

`@ryot-app/plugin-client-contract` owns schemas shared by plugin clients, the kernel, compiler, archive
tooling, and artifact persistence: bridge messages, artifact format and metadata, source file policy,
and shared capability payloads. Runtime-only policy stays with its runtime. Bridge payloads are
structured-clone values rather than JSON, so the upload source crosses the port as a `Blob`.

Artifact metadata includes content hash, artifact format, client API version, compiler version, and
bridge version. Bridge init establishes a runtime identity from a random bridge session ID and the
composition hash and version metadata. Ready repeats it, and the kernel accepts only an exact match.
The iframe reports metadata embedded in the composition document rather than treating echoed kernel
input as proof. Document replacement and retained-frame policy belong to the
[kernel host](../../kernel/client/README.md#ownership-and-isolation).

Internal modules split the package: `src/source-policy.ts` (file extensions, content types, source
predicates), `src/navigation.ts` (page targets and context, locations, navigation targets, shortcuts),
`src/bridge/lifecycle.ts` (init, document, theme, viewport, header, screen, entity picker,
overlay, and close messages), `src/bridge/capabilities.ts` (operation, collection, calendar source visibility, asset, upload,
storage, RyotQL, entity-watch, and external-link payloads), and `src/bridge/messages.ts` (the client and host message
unions). `src/index.ts` only aggregates them.

`src/artifact.ts` defines artifact schemas, exact-byte file copies, and the single metadata hash
calculation used by the compiler, ingestion, and server assembly. The hash includes the plugin name,
versions, and sorted file names, MIME types, and byte hashes. The package entry point exports these
definitions for callers.

The client artifact format, client API, compiler, and bridge protocol remain version 1.
There are no compatibility adapters for earlier development builds.

`ClientPageTarget` covers saved-view slugs, explicit plugin routes, and entities. Its page context
carries renderer identity, settings, optional named data sources, and route parameters. Authenticated
HTTP preparation returns no capability; the authenticated document request issues private artifact
grants inside the `srcdoc` document. No grant crosses the bridge in page context.

Archive validation checks integrity/compatibility, not executable provenance. Static file grants and
visibility belong to [artifact delivery](../../kernel/backend/src/modules/pages/bundles/README.md),
not bridge page context.

Entity interest uses strict state messages with at most 500 selected IDs: plugins send foreground and
visible IDs, and the kernel sends entity ID plus `populated` or `translated`. These messages have no
request IDs, acknowledgements, tickets, credentials, user identity, or server fields. The shared
declaration schema is uncapped; runtimes own aggregation and bounded selection.

The complete public `RyotClientErrorReason` set is `disposed`, `protocol`, `transport`,
`asset-failed`, `collection-failed`, `entity-save-failed`, `query-failed`, `invalid-input`,
`operation-failed`, `malformed-result`, `unsupported-capability`, `invalid-request`, and `quota`.

`entity-editor-save-request` carries an `EntityEditorSaveRequest` (submission, idempotency key, and
UTC `submittedAt`). Its result returns the editor output or fails with `invalid-request` (schema owner
is not a plugin contributor of the document), `entity-save-failed` (declared server refusal),
`malformed-result`, or `transport`. Both runtimes check the contributor rule; the kernel endpoint
remains the authority for editor declarations.

`storage-request` carries local plugin ID, bounded key, and get/set/remove action; only set carries
JSON value. Result success returns the value or null (always null for set/remove); failures use
`invalid-request`, `quota`, or `transport`. `PLUGIN_STORAGE_KEY_MAX_LENGTH` is wire policy;
`PLUGIN_STORAGE_VALUE_MAX_BYTES` is host policy. Scope, persistence, and hook behavior belong to the
[SDK storage API](../plugin-client-sdk/README.md#capabilities).

`user-settings-request` carries only a local plugin ID, never an installation or user. Result success
returns the settings record; failures use `invalid-request` or `transport`. Installation resolution
and defaults belong to the kernel host; hook behavior belongs to the
[SDK user settings API](../plugin-client-sdk/README.md#capabilities).

`calendar-source-visibility-request` carries the `SetCalendarSourceVisibilityBody` (local plugin ID,
source slug, hidden flag). Its result is bare success or `invalid-request` (the document is not the
kernel calendar, or the source is not effective for the user), `malformed-result`, or `transport`.
The kernel host accepts it only from the kernel saved view whose renderer is the calendar; that gate
limits which document may ask, not what a request may change. The server endpoint scopes the write
to the signed-in user's effective sources.

Reserved kernel shortcuts are semantic bridge messages, not public `RyotClient` capabilities. Raw
keyboard events never cross the boundary. Page shortcuts are declarative and two-way: a document
registers modifier-free keys from `PAGE_SHORTCUT_KEYS` upward, and the kernel sends a press message
back down. Both realms register the same keys, so whichever document holds focus sees the press.

This package derives specialized fields from generic HTTP-contract schemas such as entity IDs, JSON,
RyotQL documents, and asset locators. The dependency remains one-way: `@ryot-app/contract` must not
import this package.
