# Sandbox SDK

Use `@ryot-app/plugin-backend-sdk/effect` for Effect and Schema in ordinary sandbox entrypoints. `defineScript`,
`defineOperation`, `defineProvider`, `defineAutomation`, and `defineAutomationPolicy` retain the
failure type returned by `run`. Declare expected plugin failures as typed values (for example,
tagged errors), and map external-library failures where they enter the script. The host methods
continue to fail with `SandboxHostError`; composing them into `run` includes that error in its
inferred failure union. No plugin-wide error schema is required.

`executeRyotqlRecipe` keeps host failures in their original channel and returns
`RyotqlRecipeDecodeError` for malformed recipe responses. `runSandboxTestScript` infers the
script's failure channel rather than erasing it in tests.

Workflows use the restricted Effect and Schema exports from `@ryot-app/plugin-backend-sdk/workflow`.
`defineWorkflow` accepts a typed failure channel for its body. Durable replay steps can fail with
schema or journal errors or signal a pending call. The workflow definition converts body failures
to a failed replay envelope that carries the escaped error's boundary reason as `data`; its
host-facing `run` fails with `SandboxHostError` when the replay journal cannot be read.

`replay.sleep` may settle inline with host requests, returning raw null; host results remain typed.
Longer/exhausted waits use durable replay. Exact allowance and settlement rules belong to the
[runtime](../../kernel/backend/src/modules/scripts/README.md#inline-durable-calls).

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

`createUserEntity(item, options?)` creates one user-owned entity and returns `{ entityId }`. The item
contains `name`, `entitySchemaSlug`, and `properties`. `updateUserEntity(item, options?)` takes
`entityId`, `name`, `properties`, and the expected current `{ name, updatedAt, properties }`; it also
returns `{ entityId }`. These require a user subject, owned schema, and exact user-owned target;
the host binds ownership and normal service validation/hooks/receipts. Scripts cannot set ownership,
global scope, provider provenance, or `populatedAt`. `ensureUserEntities` is bootstrap-only, not
general entity creation. Runtime authorization is detailed in
[Script Writes](../../kernel/backend/src/modules/scripts/README.md#script-writes).

`mergeUserEntityData({ mergeFrom, mergeInto, entitySchemaSlug }, options?)` moves the user's events
and relationships from one user-owned entity to another of the same plugin-owned schema and returns
`{ movedEventsCount, movedRelationshipsCount }`. It requires a user-subject execution.

`createEvents(items, options?)`, `updateEvents(items, options?)`, `deleteEvents(ids, options?)`, and
`changeUserRelationships(batches, options?)` accept the same optional submission options:
`{ submittedAt, idempotencyKey }`. For stable retries, user-plugin writes require a key of 1–128
characters and the original submission timestamp. The key is scoped by account generation,
installation, script, and capability. Retry with the identical ordered data, timestamp, and key;
reusing a key with changed committed data conflicts. The timestamp supplies the stable write-command
time and any omitted event times. Omitting options keeps execution-scoped write identities.

Event updates may include an `expected` precondition
`{ kind: "fields", entityId, occurredAt, sessionEntityId, properties, absentProperties }`:
`sessionEntityId` is `null` or an ID, `properties` lists the property values that must still match,
and `absentProperties` lists keys that must still be missing, at most 100 of each and disjoint.
Delete options may include an `expected` map from every requested event ID to such a precondition.
A stale precondition fails before mutation with `data: { code: "event-stale", eventId }`; a stale
`updateUserEntity` `expected` snapshot fails with `data: { code: "entity-stale", entityId }`, which
`entityStaleReasonSchema` matches. A committed retry returns its receipt before checking the
original precondition again.
Event creation returns `{ count, outcomes }`;
each outcome is `{ index, eventId, status: "written" }`,
`{ index, reason, status: "skipped_by_policy" }`, or `{ index, reason, status: "failed" }`.
Independent valid records remain eligible when another record fails validation. A creation failure includes
`data: { count, outcomes, code, partial }`. Earlier committed items are not rolled back; identity
conflicts use `code: "mutation-conflict"` and `partial: false`. Workflow attempts remain separate
from committed item identities so an unfinished batch can be retried after partial failure. Each
operation seals its batch-hook evidence and retains its aggregate result. Committed item hooks are not recreated.

`commitUserChanges` commits a root user entity, relationships, and event creates, updates, and
deletes in one database transaction. References can target the root entity before it exists. Any
validation or commit failure leaves the entire command unchanged. File uploads are separate.

Before-stage policies receive one batch envelope: `automation` holds shared invocation metadata and
projected entity references; `items` holds `{ itemIdentity, payload }` requests. Return
`{ items: [{ itemIdentity, decision }] }` with exactly one decision for each supplied identity.
Shared metadata is sent once, not repeated per request, so normal batches retain the sandbox input limit.

## Boundary Errors

`SandboxHostError` and `SandboxFilesystemError` carry a readable `message` and optional structured
`data`. Stable boundary codes belong in `data`: `missing-required-config`, `missing-artifact-grant`,
`unavailable-operation`, `invalid-executable-target`, and `execution-limit`. Callers can branch on
those codes without replacing or parsing the message.
