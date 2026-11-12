# Agent tools

`AgentToolsService` supplies the shared per-user query, operation and data-description tool registry. `AgentToolsServiceLive` composes authentication, effective definition reads, the persisted
plugin runtime catalog and the existing operation service. The registry has no transport dependencies; the MCP module adapts its tools to Streamable HTTP.

## Service API

- `list(headers, resource?)` authenticates a session or API-key credential and returns `AgentToolDescriptor[]`.
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

`truncateJsonResult(value, byteBudget?)` is shared by registry tools and agent script history. The default is 65,536
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

## Script tool

`run_script` accepts `{ source, allowWrites? }`, defaulting to read-only execution. Source exports a
normal script definition using the small `@ryot-app/plugin-backend-sdk/agent` entry point. The
registry binds its query and operation ports to the authenticated user and transport's OAuth resource.
`invokeOperation({ name, arguments })` accepts the discovered operation name. Discovery and dispatch
share operation resolution, demo filtering, revision pinning and the existing operations service.

Callers must obtain approval before setting `allowWrites`; demo calls with this flag are refused.
The fixed MCP descriptor conservatively advertises write/destructive hints for this tool because its
behavior depends on its arguments. Read-only runs remain available to demo users. Result envelopes
carry bounded JSON, logs or compilation diagnostics and an execution ID; history and retries follow
[agent script execution](../scripts/README.md#agent-scripts).

The shared JSON result budget is implemented in `platform/tool-result.ts` and used both when retaining
script results and when returning tool responses. A smaller caller budget may truncate the retained
script result further.

## Durable assistant entrypoints

The internal API is `listTrusted(userId)`, `validateTrusted(userId, call)` and
`callTrusted(userId, { ...call, descriptorPin, idempotencyKey })`. The account ID comes from the
server's persisted turn identity, never model arguments or a public principal. Each entrypoint calls
`AuthService.resolveTrustedAccount`, which reloads preferences, disabled/bootstrap state, demo
classification and lifecycle blocking without retaining a bearer credential. HTTP and MCP continue
using `list` / `call` and ordinary request authentication.

`validateTrusted` returns `{ tool: AgentToolDescriptor, descriptorPin, hints, requiresApproval }`. It validates
JSON Schema inputs before the approval decision; authoritative command and sandbox schemas still
validate at execution. `run_script` has effective read-only hints when `allowWrites` is absent or
false; its static MCP hints remain conservative. Retain the descriptor pin with the approved call.
The pin fingerprints the complete descriptor, including immutable source identities. Invocation
rejects catalog changes, and operation admission rechecks installation, code and configuration pins.
Results use the contract's bounded `AgentToolResult` envelope, defined in `@ryot-app/contract/schema/tool-result`.

`page_list` / `page_get` and `saved_view_list` / `saved_view_get` read canonical kernel recipes,
including page draft sources and saved selections. Mutations use their owning services:
`page_create`, `page_replace_draft`, `page_compile`, `page_publish`, `page_delete`,
`saved_view_create`, `saved_view_update`, `saved_view_delete`. Compile returns the draft build
identity consumed by the existing preview host; build failures preserve typed diagnostics. Registry
create/edit commands use assistant origin supplied by server execution context, including MCP, and clear write grants. Ordinary page HTTP authoring remains user-origin. No registry
tool grants write access. Demo sessions cannot call authoring mutations.

Durable callers must supply a stable per-call idempotency key. Page and saved-view mutation owners
commit receipts in the same transaction as their changes, including creates and revision-fenced
replacements. Compilation stays outside transactions; its retained build receipt commits with the
artifact reference. Receipts follow the shared retention window. Operation and agent-script replay
continue using their existing execution owners; interrupted agent runs stay failed closed.
