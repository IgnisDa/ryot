# Agent tools

`AgentToolsService` serves the fixed agent tool surface shared by Ryo and MCP. Plugins never
contribute provider functions; they contribute capabilities that agents discover with `search` and
call from `execute`. Tool names, input schemas, descriptions and hints are constants in
`@ryot-app/contract/schema/agent-tool`; every name satisfies the strictest provider function-name
rules.

| Tool           | Approval  | Behavior                                                                       |
| -------------- | --------- | ------------------------------------------------------------------------------ |
| `search`       | none      | Lists namespaces, or ranks capabilities at `names`, `summary` or `full` detail |
| `execute`      | per write | Runs model-written TypeScript against the user's capabilities                  |
| `read_docs`    | none      | Lists documentation topics or reads one page of a topic                        |
| `page_write`   | none      | Creates or replaces a private page draft and compiles it                       |
| `page_publish` | call      | Publishes a compiled draft revision                                            |

Drafts stay private until published, so only publishing needs call approval, and only for `confirm`
write access. Demo credentials and `none` write access do not see tools that write directly
(`page_write`, `page_publish`). `agentToolHints` derives transport hints from write access: `none`
marks every tool read-only, and only `unattended` keeps destructive hints, because the server
confirms writes for `confirm`. Credentials are resolved at each service call:
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
  that both validates calls and produces its JSON Schema. `data.describe` takes the same discovery
  input as `search` and ranks the same way (`discovery.ts`) over the plugin-readable RyotQL tables
  (`kernel:tables/<name>`) and the user's entity and relationship schemas
  (`<owner>:entities/<slug>`, `<owner>:relationships/<slug>`).
- Plugin `auth: "user"` operations with an available operation script, from one executable catalog
  snapshot.
- Declared queries of effective, ready, executable installations, from persisted revision sections.

Capability IDs are `<owner>:<name>` and never rewritten: `kernel:<slug>`,
`<publisher>/<package>:operations/<slug>` and `<publisher>/<package>:queries/<name>`. Capabilities
carry the title declared by their owner, which approval screens show, and their source pins (revision, installation, configuration and content hash for operations;
revision and scope for declared queries). Operation calls go through `OperationsService` with those
pins. Declared queries and the recipe-backed kernel reads share one input derived from their document:
typed `arguments` from its parameters and a `pages` entry for each query `@ryot-app/ryotql/paging`
reports as pageable, bounded by its declared maximum and at most 100 rows. Requests are clamped to
the same bound, and fail with an instructive error when the result exceeds the execution byte cap.
RyotQL rejections reach the model with their `invalid-query` message. RyotQL-backed capabilities
declare the `RyotQLResponse` output schema. Demo credentials see only read-only kernel capabilities, declared queries and
system operations whose `demoAccess` is `allowed`; writes are refused before dispatch.

`search` ranks by term matches over IDs, descriptions and input/output field names, ties broken by
ID. Its `full` detail prints input and output TypeScript types from the JSON Schemas through
`SchemaRepresentation` (`declarations.ts`), followed by input notes listing each field's description
and numeric, length and item bounds, which the printed types cannot carry. Declared-query results
also carry the `dependency` package reference a page declares to import them.

## Execute

`execute` wraps the model's function body in a generated agent script whose `ryot.call(id, input)`
overload is typed by declarations for every capability ID the code names as a string literal. The
sandbox compiler's semantic diagnostics therefore reject unknown IDs and invalid inputs before
anything runs. The wrapper adapts the Effect host call to async/await and turns call failures into
`Error`s whose messages the code can inspect.

Each `ryot.call` is one `invokeCapability` host call. Read-only capabilities dispatch immediately.
Every other capability passes through `credentialWriteGate`, chosen from the credential's write
access: `none` declines, `unattended` approves, and `confirm` uses the transport's confirmation gate,
declining when the transport has none. A `WriteGate`:

- `authorize` approves, declines with a reason, or fails with `AgentRunSuspended`. A suspension
  persists the agent script journal and returns `{ state: "suspended" }`; calling `execute` again
  with the same idempotency key replays settled calls and resumes at the pending write.
- `settle` receives each authorized write's outcome.

Approved plugin operations dispatch with `writeConfirmed`, so the operation service does not refuse
them for lacking `unattended` access. Host-call idempotency keys are `<execution>:<host call index>`,
so a write retried after a crash replays through its owner's idempotency. Ryo and MCP supply only
their confirmation gates; see their READMEs. `approvalSubject` in `@ryot-app/contract` describes a
pending tool call or write for every confirmation surface.

## Pages and documentation

`page_write` creates a draft from `name`, `slug` and `definition`, or replaces one from `pageId`,
`expectedDraftRevision` and `definition`, then compiles it. Its definition takes each file as UTF-8
`{ path, text }`, which the contract decodes to the stored base64 file. Success returns the draft
build identity as both the result and the outcome's `preview`; build and definition failures return
the draft identity with the typed failure reason as an ordinary result. Its draft and compile steps derive their idempotency keys from
the caller's key. Assistant edits use assistant origin and clear page write access.

`AgentDocs` serves an `execute` guide plus the page SDK topics generated by
`@ryot-app/plugin-client-compiler/sdk-reference`: a `pages` authoring topic and one topic per
supported import. The kernel build writes those topics to the ignored
`sdk-reference.generated.ts`, so every server serves the same topics without loading the compiler.
`read_docs` splits topics into line-aligned pages that fit the default result budget.
