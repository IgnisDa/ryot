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

## Failure Contract

| Layer              | Owner           | Contract                                                     |
| ------------------ | --------------- | ------------------------------------------------------------ |
| Transport category | Shared boundary | Classifies the protocol outcome.                             |
| Failure reason     | Owning module   | Stable kebab-case code plus structured JSON-safe parameters. |

Expected application failures use both layers when the module can describe the rule. A transport category does not replace a domain reason. Codes are wire identifiers, not display text; parameters contain only data needed for recovery or client-owned copy.

Unexpected causes stay in backend logs. Raw compiler or runtime diagnostics are allowed only on explicit plugin-author, admin, and test surfaces. Normal APIs must not expose causes or diagnostic prose.

Persisted workflow failures retain the structured category, code, and parameters. Localized copy is never persisted. This policy intentionally has no compatibility message fields, prose parsers, or backfills.

Clients decode the contract and exhaustively handle typed variants. Tests assert categories, codes, and parameters, not backend English.

## Query Language And AppSchema

`modules/ryotql/authored` defines stored/inline documents with parameter declarations, controls,
placeholders, saved entity sources, and cursor-free default/maximum limits. `modules/ryotql/language`
is the executable grammar and response format. They share scalar grammar machinery; binding is in
`@ryot-app/ryotql/binding`. Keep authored types out of planners/executors.

`modules/ryotql/request` defines inline, saved-view, plugin-package and page execution sources,
request arguments/filter/sort/pages, visitor requests and describe request/response schemas. All
Authenticated RyotQL execution HTTP payloads use `ExecutionRequest`; the backend loads sources
under the caller's authority before binding. Publication visitors use `VisitorRequest` and
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

Sandbox subjects include a user-scoped `agent` with its access class and per-run write approval.
The generic host capability vocabulary includes `invokeOperation`; backend owners resolve and
validate operation authority. These wire shapes do not confer plugin ownership.
