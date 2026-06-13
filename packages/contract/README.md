# Contract

`@ryot/contract` owns Ryot's client-safe boundary: Effect Schema payloads, contract operations,
plugin manifests, and wire-safe failure data. The backend implements this boundary; clients consume
it without depending on backend services or runtime details.

## Failure Policy

Failures have two distinct layers:

| Layer               | Owner                         | Purpose                                                                 |
| ------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Transport category  | Shared contract boundary      | Classifies the protocol-level outcome of a request.                     |
| Module-owned reason | The module that owns the rule | Describes an expected failure with a stable code and structured values. |

Transport categories are not substitutes for domain reasons. Normal application APIs return a
module-owned typed reason when the module can describe the expected failure. Each module owns its
reason schema and its finite set of kebab-case literal codes. Codes are wire identifiers, not
localized copy, and must not be replaced with backend messages.

Reason parameters are validated, structured, JSON-safe values containing only data needed by a
consumer to act or render its own copy. Do not concatenate parameters into a message, include raw
causes, or expose compiler and runtime diagnostics in a normal application failure.

Unexpected causes stay in backend logs. Raw compiler and runtime diagnostics are permitted only on
explicit plugin-author, admin, and test surfaces. They are not normal application API data and are
not persisted as workflow failure prose.

Persisted workflow failures retain their structured transport and module-owned failure data,
including the code and parameters. Localized copy is never persisted. This is a breaking policy:
do not retain compatibility fields, message parsers, or backfills for a previous prose shape.

Clients decode the contract and own localized user copy. Use exhaustive Effect `Match` over the
typed category and reason variants; use reason parameters to choose copy and recovery actions.
Clients must not parse backend messages or render unexpected causes.

Tests assert the failure tag or transport category, module-owned code, and structured parameters.
They do not assert backend English or other prose. Tests for raw diagnostics belong only to the
explicit surfaces where those diagnostics are allowed.
