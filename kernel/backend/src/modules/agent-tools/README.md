# Agent tools

`AgentToolsService` serves the fixed agent tool surface shared by Ryobot and MCP. Plugins never
contribute provider functions; they contribute capabilities that agents discover with `search` and
call from `execute`. Tool names, input schemas, descriptions and hints are constants in
`@ryot-app/contract/schema/agent-tool`; every name satisfies the strictest provider function-name
rules.

| Tool           | Approval  | Behavior                                                                       |
| -------------- | --------- | ------------------------------------------------------------------------------ |
| `search`       | none      | Lists namespaces, or ranks capabilities at `names`, `summary` or `full` detail |
| `execute`      | per write | Runs model-written TypeScript against the user's capabilities                  |
| `read_docs`    | none      | Lists documentation topics or reads one page of a topic                        |
| `page_write`   | call      | Creates or replaces a page draft and compiles it                               |
| `page_publish` | call      | Publishes a compiled draft revision                                            |

Demo credentials do not see call-approved tools. Credentials are resolved at each service call:
`list`/`call` authenticate request headers with the transport's OAuth resource, and
`listTrusted`/`validateTrusted`/`callTrusted` reload the persisted account for durable assistant
turns. Results use the shared bounded `AgentToolResult` envelope from
`@ryot-app/contract/schema/tool-result`; `truncateJsonResult` in `platform/tool-result.ts` bounds
the UTF-8 serialization of the whole envelope (default 65,536 bytes, minimum 64).

## Capability catalog

`CapabilityCatalog` assembles the per-user catalog from:

- Kernel capabilities owned by `KernelCapabilities`: `data.describe`, inline `query`,
  `collections.list`, `collections.members`, `pages.list`, `pages.get`, `pages.delete` and
  `saved-views.{list,get,create,update,delete}`. Each is declared once with an Effect Schema input
  that both validates calls and produces its JSON Schema.
- Plugin `auth: "user"` operations with an available operation script, from one executable catalog
  snapshot.
- Declared queries of effective, ready, executable installations, from persisted revision sections.

Capability IDs are `<owner>:<name>` and never rewritten: `kernel:<slug>`,
`<publisher>/<package>:operations/<slug>` and `<publisher>/<package>:queries/<name>`. Capabilities
carry their source pins (revision, installation, configuration and content hash for operations;
revision and scope for declared queries). Operation calls go through `OperationsService` with those
pins; declared and inline queries cap root pages at 100 rows and fail with an instructive error when
the result exceeds the execution byte cap. RyotQL-backed capabilities declare the `RyotQLResponse`
output schema. Demo credentials see only read-only kernel capabilities, declared queries and
system operations whose `demoAccess` is `allowed`; writes are refused before dispatch.

`search` ranks by term matches over IDs, descriptions and input/output field names, ties broken by
ID. Its `full` detail prints input and output TypeScript types from the JSON Schemas through
`SchemaRepresentation` (`declarations.ts`).

## Execute

`execute` wraps the model's function body in a generated agent script whose `ryot.call(id, input)`
overload is typed by declarations for every capability ID the code names as a string literal. The
sandbox compiler's semantic diagnostics therefore reject unknown IDs and invalid inputs before
anything runs. The wrapper adapts the Effect host call to async/await and turns call failures into
`Error`s whose messages the code can inspect.

Each `ryot.call` is one `invokeCapability` host call. Read-only capabilities dispatch immediately.
Every other capability passes through the caller's `WriteGate`:

- `authorize` approves, declines with a reason, or fails with `AgentRunSuspended`. A suspension
  persists the agent script journal and returns `{ state: "suspended" }`; calling `execute` again
  with the same idempotency key replays settled calls and resumes at the pending write.
- `settle` receives each authorized write's outcome.

Host-call idempotency keys are `<execution>:<host call index>`, so a write retried after a crash
replays through its owner's idempotency. Ryobot and MCP supply their own gates; see their READMEs.

## Pages and documentation

`page_write` creates a draft from `name`, `slug` and `definition`, or replaces one from `pageId`,
`expectedDraftRevision` and `definition`, then compiles it. Success returns the draft build identity
as both the result and the outcome's `preview`; build failures return the draft identity with typed
diagnostics as an ordinary result. Its draft and compile steps derive their idempotency keys from
the caller's key. Assistant edits use assistant origin and clear page write access.

`AgentDocs` serves an `execute` guide plus the page SDK topics generated by
`@ryot-app/plugin-client-compiler/sdk-reference`: a `pages` authoring topic and one topic per
supported import. Bundled servers read `agent-docs.json` beside the bundle; unbundled TypeScript
generates topics from current SDK sources. `read_docs` splits topics into line-aligned pages that
fit the default result budget.
