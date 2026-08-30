# Contract

`@ryot-app/contract` is the client-safe HTTP boundary: Effect Schema payloads, operations, generic wire schemas, plugin manifests, authentication middleware, wire-safe primitives, and failure data. The backend implements it; clients consume it without backend or runtime dependencies.

The iframe bridge, client artifact format, client source policy, and shared client-plugin capabilities belong to `@ryot-app/client-plugin-contract`.

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
