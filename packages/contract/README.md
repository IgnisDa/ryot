# Contract

`@ryot-app/contract` is the client-safe HTTP boundary: Effect Schema payloads, operations, generic wire schemas, plugin manifests, authentication middleware, wire-safe primitives, and failure data. The backend implements it; clients consume it without backend or runtime dependencies.

The iframe bridge, client artifact format, client source policy, and shared client-plugin capabilities belong to `@ryot-app/plugin-client-contract`.

## Client Pages And Manifests

The plugin manifest client API is version 1. Its declarative client surface names public exports,
routes, entity detail/presentation exports, and the plugin-owned home view. Public source exports
components or presentation definitions; generated compiler code owns application bootstrap.

Saved views store a renderer reference, settings, and optional named RyotQL data sources. Client-page
HTTP routes author renderers, prepare pages by saved-view slug or plugin route, issue reusable
authenticated artifact grants, and check prepared-page freshness separately. Static artifact requests
use the grant and immutable artifact hash; plugin catalog entries do not select or serve artifacts.

### Display text

- `modules/plugins/manifest-text` defines `ManifestText`, the only schema for manifest display
  fields: a `{ key }` reference without arguments into the declaring catalog. `manifestTexts`
  lists every display field of a manifest with its path, and with the argument names its message
  must declare exactly (none unless listed); `manifestKernelMessages` lists the kernel messages that
  kernel-provided schema building blocks embed. `modules/plugins/manifest-text-issues` exports
  `manifestTextIssues(manifest, englishCatalog)`, the one check shared by `ryot plugin build` and
  installation: manifest text names a plugin key with exactly its declared arguments, and every
  embedded kernel message (including nested ones) names an English kernel key whose argument names
  and kinds its parameters match. It is a separate module because it loads the English kernel
  catalog.
  `testing` exports `manifestCatalogs(manifest, texts?)`, an `en` catalog covering every manifest
  text for tests, rendering `texts[key]` (default the key) followed by the declared arguments.
- Shared shapes that both plugins and users author keep `DisplayText` (`FilterChoice`,
  `SavedViewTableColumn`, `BrowseSort`), and their plugin-authored manifest variants take
  `ManifestText`: `AuthoredBrowseField` and `AuthoredSavedViewTableColumn`, built from the same
  text-parameterized schema factories. Definitions resolve them with the owner's namespace
  (`resolveBrowseField`), so stored browse fields (`BrowseField`) carry `Message` labels.
- `AppSchema<Text>` is parameterized by its display text. Property and choice `label` and the
  optional `hint` are display text; forms show the hint as help. A static choice with
  `kind: "region"` has no label: its value is an ISO 3166-1 alpha-2 or UN M49 region code, and
  clients name it in the viewer's locale and sort region choices by that name. `description` is English
  documentation for models and developers and is never rendered in forms. Manifests use
  `AuthoredAppSchema`, whose text is `AuthoredSchemaText`: `ManifestText`, or a kernel message for
  kernel-provided building blocks such as `schema/core` fields and review, integration and data
  import fields. `stampAppSchema` resolves manifest text with the plugin namespace and keeps kernel
  messages; `mapAppSchemaText` renders text, such as `formatForModel` for model-facing JSON
  Schema. RyotQL parameter labels are `DisplayText` in `RyotQLDocument`, which users and the
  HTTP API author. Documents authored in plugin or kernel code are `PluginRyotQLDocument`, whose
  parameter text is `AuthoredSchemaText`: declared `queries`, saved-view `dataSources` and recipes
  sent inline. `manifestTexts` lists the labels of declared documents. `stampRyotQLDocument` stamps
  them like `stampAppSchema`, and `resolvePluginDocument` also binds `self` references to the
  installed plugin.
- `modules/ryotql/row-source` defines `RowText` and `AuthoredRowText`: a message whose arguments
  are bound by name to row output fields, such as a calendar source `caption`. Queries yield codes
  and numbers; the message's `select` turns codes into text.
  Model-facing manifest text (operation and query titles and descriptions, assistant
  instructions, hook, cron and script names) stays English.
- Served definition names are stamped `Message`s (`@ryot-app/i18n`): the plugin ID, or `kernel` for
  kernel definitions, is the namespace. Text a user can rename, such as saved view names, is
  `DisplayText`: a message until the user renames it, then user-authored text.
- `GET /plugins/messages/:locale` returns one locale's catalogs of the caller's listed plugins;
  plugin inspection returns the archive's catalogs for its manifest text.

## Failure Contract

| Layer              | Owner           | Contract                                                     |
| ------------------ | --------------- | ------------------------------------------------------------ |
| Transport category | Shared boundary | Classifies the protocol outcome.                             |
| Failure reason     | Owning module   | Stable kebab-case code plus structured JSON-safe parameters. |

Expected application failures use both layers when the module can describe the rule. A transport category does not replace a domain reason. Codes are wire identifiers, not display text; parameters contain only data needed for recovery or client-owned copy.

Unexpected causes stay in backend logs. Raw compiler or runtime diagnostics are allowed only on explicit plugin-author, admin, and test surfaces. Normal APIs must not expose causes or diagnostic prose.

Persisted workflow failures retain the structured category, code, and parameters. Localized copy is never persisted. This policy intentionally has no compatibility message fields, prose parsers, or backfills.

Clients decode the contract and exhaustively handle typed variants. Tests assert categories, codes, and parameters, not backend English.

### Message reasons

- `errors.ts` boundary errors (`BadRequest`, `NotFound`, `Conflict`, `RateLimited`, `InternalError`,
  `SubmissionExpired`), `EntityEditorRefused` and `PluginOperationRejected` exist only to select an
  HTTP status. They share `contractErrorFields`: a single `reason: Message` (`@ryot-app/i18n`) whose
  key is the code and whose params are the parameters. Helpers such as `badRequest` accept only
  messages. Their `Error.message` is empty; `messageReasonOf` reads an error's message reason and
  `unknownToMessage` reports its key.
- `ValidationFailed` adds `issues: { path, issue }[]`, where `issue` is a closed
  `ValidationIssueCode`. `schemaValidationFailed` derives it from an Effect Schema issue;
  request decoding failures return it with HTTP 400.
- A sandbox reports a `SandboxBoundaryReason`, whose `operation-rejected` reason carries the
  plugin's `LocalMessage`. Where the backend records a sandbox failure, `stampBoundaryReason`
  stamps the run's catalog namespace (dropping a rejection from a run without one), so
  `SandboxRunError` and backend execution results carry a `StampedSandboxBoundaryReason`.
  `boundaryReasonMessage` maps each stamped reason to its message: the plugin's own message for an
  operation rejection, a kernel message otherwise. The code union stays the machine-readable
  classification. `PluginOperationRejected` carries the stamped rejection message.
- A before-stage policy rejects with a `LocalMessage` from its owner's catalog. The kernel stamps the
  policy owner's namespace, and the `policy-rejected` reasons of `EntityBadRequest`,
  `EventBadRequest` and `RelationshipBadRequest`, like a `skipped_by_policy` event outcome, carry
  that `Message`.
- `DbError`, `SandboxRunError` and `TimeoutError` are internal: their `message` is a diagnostic and
  never reaches a client.
- A contract test walks every `AppContract` error schema and fails on string fields named like text
  (`message`, `detail`, `title`, …) outside its explicit list of plugin-author diagnostics.

## Query Language And AppSchema

`modules/ryotql/authored` defines stored/inline documents with parameter declarations, controls,
placeholders, saved entity sources, and cursor-free default/maximum limits. `modules/ryotql/language`
is the executable grammar and response format. They share scalar grammar machinery; binding is in
`@ryot-app/ryotql/binding`. Keep authored types out of planners/executors.

`modules/ryotql/request` defines inline, saved-view, plugin-package and page execution sources,
request arguments/filter/sort/pages, visitor requests and describe request/response schemas. All
Authenticated RyotQL execution HTTP payloads use `ExecutionRequest`; the backend loads sources
under the caller's authority before binding. Plugin and kernel code send `PluginExecutionRequest`
and `PluginDescribeRequest`, whose inline document is a `PluginRyotQLDocument`; the trusted side
that knows the authoring namespace converts them with `stampExecutionSource`. Publication visitors use `VisitorRequest` and
`VisitorDescribeRequest`, naming only a query of the publication's page, without execution sources
or inline documents. Describe routes return normalized strict parameters and resolved control
choices. Query responses carry optional generic `execution` metadata (`now` in epoch milliseconds
and the account `timeZone`) captured from the same context used to bind expressions. Reporting
consumers require this metadata, including for empty results.

`schema/app-schema-definition` owns generic definition/rule validation. `modules/ryotql/parameters`
adds the parameter subset and `bindArguments`, which delegates values, defaults and conditional rules
to `parseAppSchemaPropertiesSafe` and rejects undeclared keys. `entity-source` string references name
saved selections; loading them is an authority-aware backend responsibility.

`schema/app-schema-inference` exports `AppSchemaInput` and `AppSchemaValue` for literal declaration
inference. Required inputs with defaults may be omitted; bound values include defaults. Optional
values can be null. Conditional rules still require runtime validation.

`schema/app-schema-json-schema.appSchemaJsonSchema` emits JSON Schema Draft 2020-12 for expressible
constraints: object policies, scalar bounds/patterns/formats, arrays, static choices, defaults,
conditional required rules and visibility. Materialize dynamic choices first. Query tool schemas
must convert `{ ...parameters, unknownKeys: "strict" }`, matching argument binding. JSON Schema
provides input/output descriptions; normalization, reference authority, managed assets, time-zone
membership and business rules remain authoritative Effect validation.

The pages module includes authored `PageDefinition` documents and demo-protected page mutation contracts alongside client preparation. Actor/origin is server-owned; row reads use RyotQL page recipes. Build results identify the compiled draft revision, definition hash and artifact hash for read-only preview composition.

## Publications

`modules/publications/schemas` defines `PublicationDefinition` as `{ page, arguments, mode }`.
`PublicationPageReference` selects `{ kind: "kernel", name: "publication" }` or
`{ kind: "page", pageId }`; `PublicationMode` is `live` or `snapshot`. Create and republish bodies
include this definition alongside title, description, icon and owner-name settings. Link and session
contracts remain separate from the definition.

Owner arguments are partial bindings. `modules/ryotql/parameters.bindPartialArguments` validates
explicit values with the same AppSchema definitions, normalization and conditional rules as
`bindArguments`, while allowing absent required parameters and returning only explicitly supplied
keys. Defaults participate in validation but do not become owner bindings. At execution the backend
must overlay owner bindings on visitor arguments, then use full `bindArguments` to apply defaults and
validate required values. Share intents use `modules/ryotql/entity-source.EntitySourceReference`;
the host converts that intent to the kernel publication page and an encoded source argument.

`PublicationStatusResponse` is ready (with optional `itemCount`) or needs-attention with a
`PublicationReadinessIssue`: page-unavailable, dependency-unavailable (package reference),
source-unavailable, bindings-invalid (AppSchema issues), or snapshot-too-large (`limitBytes`). Owner
bad requests use the same readiness reasons. Visitor unavailability exposes reason codes without
owner diagnostics. Visitor presentation includes `mode`, also available as `context.settings.mode`. Visitor presentation counts are optional; contexts carry no query documents and
select either the kernel publication renderer or a published, read-only page renderer.

These contracts define no snapshot storage, snapshot navigation policy, or live-page revision policy.

Sandbox subjects include a user-scoped `agent` with its access class. The generic host capability
vocabulary includes `invokeCapability`; backend owners resolve capability IDs, validate authority
and gate writes. These wire shapes do not confer plugin ownership.

## Assistant

`modules/assistant/contract` registers `AssistantGroup`: `renameConversation`, `deleteConversation`,
`submit`, `interrupt`, `decide`, `providerMetadata`, `configureProvider`, `deleteProvider` and
`savePage`. Renaming, submission, interruption and deletion explicitly allow demos; services restrict
their tools to read-only behavior. Approval, provider configuration and page saving are
demo-protected. Submission without a conversation ID creates one titled from the message. It returns
only the conversation and turn IDs and uses a caller request ID, unique per user, for replay. Decisions fence a tool-call
revision. Provider key omission retains the stored key; deletion removes the entire user override.

`modules/assistant/schemas` owns conversation/turn/message schemas, tool calls (agent tools from
`schema/agent-tool`, and the pinned `schema/capability` calls `execute` makes), approvals, and revision-bound page-preview parts using `PageDraftBuildIdentity`. Save-page
commands include that build identity and a request ID; implementation must atomically record replay
and publish/create the saved view. Shared bounded results live in `schema/tool-result.AgentToolResult`.
Provider metadata reports key presence only. No key is part of a persisted-history read model.
