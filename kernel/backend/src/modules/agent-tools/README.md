# Agent tools

`AgentToolsService` supplies the shared per-user query, operation and data-description tool registry. `AgentToolsServiceLive` composes authentication, effective definition reads, the persisted
plugin runtime catalog and the existing operation service. The registry has no transport dependencies; the MCP module adapts its tools to Streamable HTTP.

## Service API

- `list(headers, resource?)` authenticates a session or API-key credential and returns `AgentTool[]`.
- `describeData(headers)` authenticates the credential and returns the complete typed
  `AgentDataDescription`: effective entity schemas with properties, browse fields and nested event
  schemas, plus relationship schemas and their endpoints/properties. Projection schemas are included
  for events and relationships. This internal reader is unbounded; transport consumers use `call`.
- `call({ name, arguments, headers, resource?, contentHash?, revisionId?, idempotencyKey?, byteBudget? })` authenticates,
  resolves the tool for that user and returns a bounded `AgentToolResult`. `describe_data` takes `{}`.
  Operation arguments go unchanged to `OperationsService.invoke`; the script's Effect Schema owns
  validation and business rules. Manifest input/output JSON Schemas describe the operation payload,
  before the result envelope is applied.

Tool metadata contains `name`, `description`, `input`, `output`, `hints` and `source`. Operation names
are `<publisher>.<name>.<operation-slug>` from the package identity, independent of display names and
local plugin IDs. Their source carries `packageId`, `operationSlug` and `contentHash`; callers should
send the listed content hash back to `call` to reject changes since discovery. Without it, the call
pins the revision selected during that call. The existing operation service rechecks availability and
revision identity during admission, retains configuration/script pins and handles idempotent replay.
Its typed refusals and runtime failures propagate unchanged.

Discovery takes one executable plugin catalog snapshot and checks operation-script metadata in one batched read at those
immutable revision IDs. It includes only `auth: "user"` declarations with an available operation script. Hidden,
unready, foreign-owned, quarantined or unusably configured installations follow the existing catalog
policy. Reads use persisted revision sections and definition rows, never complete manifests or script
bodies. Effective data definitions follow definition effectiveness, which is deliberately distinct
from operation executability.

Demo discovery additionally requires semantic `hints.readOnly`, a system installation and existing
`demoAccess: "allowed"` permission. Calling a known excluded operation returns
`DemoOperationProtected` before dispatch, even when its existing demo permission allows a write.
Unknown and inaccessible tool names return `NotFound`; invalid budgets and describe arguments return
`BadRequest`. Credentials are resolved at each service call rather than accepted as caller-supplied
user IDs or access classes.

## Result budget

`truncateJsonResult(value, byteBudget?)` is reusable by future registry tools. The default is 65,536
bytes; budgets must be safe integers of at least 64 bytes. The budget covers the UTF-8 serialization
of the entire result envelope, including escaping and the marker:

- Complete: `{ truncated: false, value: <JSON result> }`.
- Truncated: `{ truncated: true, jsonPrefix: <prefix of serialized result> }`.

The prefix ends at a Unicode code point boundary and may be incomplete JSON. Consumers must not
execute or parse it as a complete result. Truncation applies to arrays, objects and primitive values;
it never changes an operation's execution or committed writes. The budget bounds the response, not
sandbox execution memory or the cost of constructing the original result.

## Query tools

`query` accepts an inline `ExecutionRequest` and runs it with the plugin audience. `collections` and
`collection-members` use the canonical recipes with request arguments, filters, sorts and pages.
The members tool binds its collection source from `collectionId`; callers cannot supply an encoded source.
Query results exceeding the execution byte cap return a truncation marker.
Declared queries are discovered from effective executable installations and persisted revision
sections. Their names are `<publisher>.<name>.<query-name>`, and their argument JSON Schemas
come from the declaration's parameter AppSchema. Discovery includes the immutable revision ID;
`call` accepts `revisionId` to reject stale discovery and pins the selected revision during execution.

Queries use the same source resolution, parameter defaults, reference authority, cursor identity and
semantic validation as HTTP and sandbox reads. Root pages are capped at 100 rows, and query results
have a maximum 65,536-byte budget. Query tools remain available to demo credentials, with the existing
demo table/field policy enforced by RyotQL. Validation failures retain the query service's typed errors.

Tests cover real persisted catalog ownership, readiness/configuration, demo filtering/refusal,
definition descriptions and delegation at the `OperationsService` boundary. Existing operation tests
own admission, configuration/script pinning and runtime validation. Result tests cover escaping,
multibyte Unicode, primitive/array results and invalid budgets.

Transport owners may supply the expected OAuth resource to `list` and `call`. Omission retains the
ordinary API audience. The registry propagates this expected audience into operation authentication;
it never accepts a caller-supplied authenticated principal. MCP supplies its own resource, and API-key
behavior stays the same. The MCP transport pins the source revision from its current descriptor when
calling operations and declared queries.
