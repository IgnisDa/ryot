# Sandbox SDK

Use `@ryot-app/plugin-backend-sdk/effect` for Effect and Schema in ordinary sandbox entrypoints. `defineScript`,
`defineOperation`, `defineProvider`, `defineAutomation`, and `defineAutomationPolicy` retain the
failure type returned by `run`. Declare expected plugin failures as typed values (for example,
tagged errors), and map external-library failures where they enter the script. The host methods
continue to fail with `SandboxHostError`; composing them into `run` includes that error in its
inferred failure union. No plugin-wide error schema is required.

`executeRyotqlRecipe(executeRyotql, recipe, arguments, options?)` takes the host execution function
and sends it a `PluginExecutionRequest`; the host stamps inline parameter text with the run's
plugin namespace.
Options carry request filter, sort, and pages; selected recipes include their named query. Server
binding supplies execution clock and authority. `executeRyotqlRecipe` keeps host failures in their original channel and returns
`RyotqlRecipeDecodeError` for malformed recipe responses. `runSandboxTestScript` infers the
script's failure channel rather than erasing it in tests.

Workflows use the restricted Effect and Schema exports from `@ryot-app/plugin-backend-sdk/workflow`.
`defineWorkflow` accepts an optional checkpoint schema and calls `run(input, step, checkpoint, execution)`.
The checkpoint is `null` initially. `step.save(state)` ends the current bounded step; the next step
receives the saved state. Return a value to finish. Bounded workflows can omit the checkpoint schema.
Use `step.activity` and `step.child` to invoke typed scripts and workflows. There is no workflow sleep API.

The runtime retains a private call journal only for the unfinished step, then atomically saves its
checkpoint and discards completed step receipts. Calls within that step must remain deterministic.
Body failures retain their boundary reason and external delivery ambiguity; checkpoints do not make
an uncertain external action safe to retry. See the [authoring guide](../plugin-kit/README.md#checkpoint-workflows).

Shared plugin sources use the environment-neutral `@ryot-app/plugin-kit/effect` shim. It does not
export `Effect`; import the sandbox Effect surface in backend-only sources.

## Markdown Conversion

`@ryot-app/plugin-backend-sdk/markdown` exports the pure synchronous
`normalizeMarkdown(input: string, options?: { baseUrl?: string }): string`. It parses Markdown and
embedded HTML and returns restricted canonical Markdown without a final newline. It retains
paragraphs, strong and emphasized text, lists, blockquotes, hard breaks, HTTP/S links, and nested
inline `:spoiler[...]` and block `:::spoiler` directives. Relative links require `baseUrl`; unsafe or
invalid links become their label text. Directive attributes and unknown directive wrappers are
removed. Headings become strong paragraphs, tables become textual rows, code becomes literal text,
and images become alt text. Executable HTML, forms, and embedded media are removed. No raw HTML is
emitted. Normalizing canonical output again gives the same result.

`@ryot-app/plugin-backend-sdk/markdown-text` exports the dependency-free synchronous
`escapeMarkdownText(input: string): string` for literal input. It escapes punctuation and leading
whitespace, preserves blank-line paragraphs, and represents line breaks explicitly. This helper is
compiler-bundled; rich conversion uses the `markdown` runtime in the data and full snapshot tiers.
Both helpers require no host capabilities.

## Host Surface

Ordinary scripts use `ScriptHost`; before-stage policies use `PolicyHost`, which exposes only the
policy-safe methods. A helper type such as `Pick<ScriptHost, "httpCall">` narrows its TypeScript
surface but does not grant host access. `defineManifest` describes static identity, kind, and
kind-specific authored fields; capability metadata comes from the compiler, not the authored
manifest.

`src/core/host-contracts.ts` owns argument/result schemas; `src/intrinsics.ts` maps non-host SDK
helpers to capabilities by canonical module/export, not import alias. Contract wire schemas own the
capability vocabulary; kernel requirements/execution-policy records must exhaustively cover changes.

Host calls only read. An operation returns `{ output, changes? }`; `changes` is a `ChangeSet`
(`changeSetSchema` from `core`, built with `rootEntity`, `existingEntity`, `upsertedGlobalEntity` and
`combineChangeSets`) that the kernel commits after the run in one database transaction. Its parts and
per-writer authority are listed in the [plugin authoring guide](../plugin-kit/README.md#change-sets);
`CHANGE_SET_LIMITS` holds their bounds. Any validation, authority, or commit failure leaves the entire
change set unchanged. File uploads are separate.
`events.baselines` accepts up to 100 distinct entity IDs and their `eventScope` revisions. These
scalar guards do not grow with the history or inventory. Event creates/updates may retain logical
source order with `orderAfter`; an update with `orderAfter: null` restores physical creation order.
Runtime authorization is detailed in
[Script Writes](../../kernel/backend/src/modules/scripts/README.md#script-writes).

A retry of a whole operation is covered by the key its caller passes to `operations.invoke`, which replays
the original result.

Fold scripts use `FoldInput`, `FoldOutput` and `FOLD_LIMITS` from
`@ryot-app/plugin-backend-sdk/folds`. See
[folds](../../kernel/backend/src/modules/events/README.md#folds).

Before-stage policies receive one batch envelope: `automation` holds shared invocation metadata and
projected entity references; `items` holds `{ itemIdentity, payload }` requests. Return
`{ items: [{ itemIdentity, decision }] }` with exactly one decision for each supplied identity.
A `reject` decision's `reason` is a `LocalMessage` from the plugin's catalog; the kernel stamps the
plugin's namespace before it reaches a caller.
Shared metadata is sent once, not repeated per request, so normal batches retain the sandbox input limit.

## Boundary Errors

`SandboxHostError` and `SandboxFilesystemError` carry a readable `message` and optional structured
`data`. Stable boundary codes belong in `data`: `missing-required-config`, `missing-artifact-grant`,
`unavailable-operation`, `invalid-executable-target`, `execution-limit`, `operation-rejected`, and
`operation-conflict`.
Callers can branch on those codes without replacing or parsing the message. When the kernel rejects
a host call with a message reason, `data` is that stamped `Message` and `message` is its key.

An operation that refuses a request for a deterministic, user-correctable reason fails with
`new OperationRejectedError({ reason })` from `@ryot-app/plugin-backend-sdk/operation`, where
`reason` is a `LocalMessage`; its `data` is the local `operation-rejected` boundary reason, and the
kernel stamps the run's plugin namespace when it records the failure. It reaches the caller as an
HTTP 422 `PluginOperationRejected`; any other thrown error stays an HTTP 502
`PluginInvocationError` with `runtime-failed`. Use it only for operation entrypoints, never for
provider scripts, which report failures through their results. An operation that finds its baseline
stale before it can build changes fails with `new OperationConflictError({ conflict })`, where
`conflict` is a `CommitConflictCode`; it reaches the caller as the HTTP 409 `changes-conflict` that a
stale commit produces.

## Agent scripts

`@ryot-app/plugin-backend-sdk/agent` exposes `defineManifest`, `defineScript` and the `AgentHost`
type for kernel-generated agent executions. Agents do not author these definitions: the `execute`
agent tool wraps model-written code in one. Agent definitions use an empty object input and a JSON
output. Their host exposes `log`, `span` and `invokeCapability({ id, input })`; the kernel authorizes
each capability call, including per-write approval, and narrowing TypeScript types never grants
capabilities. Agent scripts cannot use HTTP, raw mutations, direct queries, filesystem or
plugin-owned configuration.
