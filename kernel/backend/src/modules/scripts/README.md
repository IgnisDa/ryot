# Scripts

`ScriptExecutionWorkflow` owns each invocation: pin compiled code, replay from the start, and turn
mutable host calls into durable requests. A durable wait ends the isolate; replay starts a fresh one.
[Sandbox isolation, files, and limits](../../../../sandbox/README.md) belong to `kernel/sandbox`.

## Build And Execution

Plugin ingestion validates precompiled JavaScript and hashes without compiler workers or
source-provenance proof. Authoring builds compile `.sandbox.ts`; `tooling/kernel-scripts.ts`
generates source-zero kernel scripts. Root scripts pin before execution; children resolve from the
exact pinned plugin revision when first observed and retain that target for their durable step.

Every invocation reloads persisted authority and verifies compiled SHA-256 and package identity
across manifest, plugin row, and authority projection. Historical pins preserve code/config/definitions,
not expired authority: fresh host calls still enforce current account and installation access.
System authority requires verified kernel/system ownership; user plugins execute as their owner.
Kernel children preserve the caller's lifecycle principal, not unrestricted kernel write authority.
The bounded compiled-module cache stores code/format only; failed loads and authority are not cached.

## Invocation Context And Replay

Automation input contains trusted IDs, hook/causation/time/user metadata, and the pinned script's
projection of immutable trigger evidence. Configuration is read through `getPluginConfig`, never
copied into input. Mutation projections select snapshot properties and update comparisons; policy
projections see earlier validated patches in hook order. Current-state RyotQL cannot recover omitted
trigger-time data. Missing, incompatible, non-JSON, oversized, or invalid input fails closed before
execution. Invocation bounds include trusted fields after projection, independently of batch item
chunking. Author-facing projection shapes are in the
[Plugin Kit](../../../../../packages/plugin-kit/README.md#execution-authority).

An unrecorded mutable call or `replay.sleep` ends replay unless it settles inline. The workflow
dispatches it through its owner, journals typed results, and replays. Recorded calls reuse results.
Successfully completed ending requests also persist validated results and targets in deferred slots
keyed by parent execution/request index. Replay validates the envelope and identity before reuse.
This preserves completed members of partially settled batches; journal appends remain ordered.

Dispatch uses the original workflow owner so cancellation remains attached. Failure, interruption,
suspension, and defects do not complete a slot. Delayed completions or concurrent misses may repeat
idempotent dispatch: durable ownership is not a single-flight guarantee.

### Journal projection

PostgreSQL workflow persistence is authoritative; Redis is a reconstructible append-only projection.
Entries contain indexed metadata (encoded length, chunks, SHA-256) and chunked JSON results. Atomic
append accepts identical existing metadata but rejects divergent metadata without writing. Each append
refreshes TTL.

Admission pins metadata for the enqueued journal length and ignores later entries without decoding
the prefix. Each permitted chunk read rechecks pinned metadata/length and retains its permit through
cancellation. The isolate reassembles entries in external memory, validates schema/index, and must
report the same journal length. Bounds are in the
[runtime limits](../../../../sandbox/README.md#limits).

Missing projections fail with `SandboxProjectionMissing`; changed/unreadable projections fail as
infrastructure faults. A read fault overrides script outcome and cannot be caught by the script.
The workflow reconstructs the full projection from persistence and retries under the next step ID,
at most twice before `resource-unavailable`; replay outcome metrics label projection loss `missing`.

### Inline durable calls

A replay batch includes requests registered before its first unrecorded call executes. The
execution-scoped gate validates eligible host/sleep batches, which the sidecar settles over the framed
socket while parking its CPU lease. JS fibers and timers freeze. Sleeps return raw null; host calls
retain typed outcomes. Grant-carrying executions may settle inline. HTTP admission can settle matched
hops, redirects, and short 429 delays without child workflows.

Backend-only `pendingInline` metadata retains completed members and HTTP continuation, never exposing
them through script input. Identity and byte bounds are validated; continuation reuses completed
slots and retained tickets. Interrupt cleanup cancels the last declaration binding. The sidecar
extends its local journal, and the parent validates request identities/argument hashes before
persisting returned entries ahead of the ending request.

Inline sleep/admission waits share a 1,000 ms allowance per replay and a 1,000 ms per-wait threshold.
Allowance is reserved before waiting and unused cancelled time is refunded by monotonic clock.
Longer/exhausted waits defer. A batch also defers when journal indexes diverge, bytes/results or
continuations cannot fit, its lane cannot reserve the whole batch, or dispatch fails. Declared result
bounds cannot exceed 80 MiB. Settled evidence stays charged at three times encoded size until run
end; deferred calls may already have executed and must tolerate replay.

Only validated inline waits pause the script timeout/extend session expiry. Settlement is bounded to
30 seconds per wait and five minutes absolute; HTTP attempts remain eight seconds. The isolate must
be disposed within two seconds before its reservation is refunded.

## Durable Ownership

- PostgreSQL owns execution, completed requests, child/activity results, and terminal output. Redis
  loss rebuilds from the workflow journal; identity/argument hashes detect nondeterminism.
- Idempotent service operations run as activities; workflow-owning services compose deterministic
  children. Workflow code uses neither ambient time/randomness nor ordinary host functions.
- `Effect.fail` is expected workflow failure; a throw is an execute-phase defect.
- Each HTTP network attempt is durable, but external mutations remain at-least-once across the
  crash-before-result-persistence window. Inline results persist with the replay queue result.
- Input artifacts remain pinned until completion/cancellation. Generated handles are workflow-scoped;
  TTL is leak cleanup, not normal ownership. Logs/spans/console output are diagnostics, not journal.
- Trusted subjects override input user IDs; relayed ingestion/automation attribution is owner-validated.

## Capabilities

Compiler-derived local metadata constrains every runner, host, durable dispatch, and filesystem grant.
Replay never analyzes current source or borrows child capabilities. Authored identity/kind/projection
fields are validated separately and grant no privileges. Runtime policy combines script kind,
subject, scope, provider association, and bootstrap designation; services enforce domain ownership.

`authorization/` owns principal policy, `SANDBOX_CAPABILITY_REQUIREMENTS` is the exhaustive vocabulary,
and host contracts have exhaustive durable dispatch coverage. New operations extend these owners,
not a source-authored grant list. `scratch`/`artifact-read` are filesystem grants requiring trusted
resources, not host calls.

| Subject                   | Capability boundary                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Valid subjects            | Diagnostics, HTTP, cache/persistent values, and pinned plugin configuration                                              |
| User/user automation      | Events, schema/integration/preference reads, managed-asset verification, relationships, and RyotQL                       |
| Designated user bootstrap | `ensureUserEntities` within its plugin schemas, in either plugin scope                                                   |
| User-subject plugin       | User-owned entity create/update/delete/save/merge within pinned plugin ownership                                         |
| Pinned system plugin      | Global entity/relationship upserts and RyotQL within owned definitions; entity upsert also requires provider association |
| User/system automation    | Signals; notification delivery requires a user automation run                                                            |
| Own integration run       | Access/invalidation of OAuth fields declared by its current settings schema                                              |

User-subject definition reads pin only the caller's own declarations; visible foreign definitions
remain current. Entity/event reads use RyotQL, not schema metadata calls. Before policies receive
only the [policy-safe surface](../../../../../packages/plugin-kit/README.md#lifecycle-hooks).

Hidden unfinished installations may execute only their dispatched initializer under an exact current
installation/activation binding, `installing` health, `isInitialized = false`, account ownership, and
pinned designated script. Ordinary hidden execution is unavailable. Completed initialization is not
repeated; stale activations and quarantine never authorize another initializer.

Configuration reads enforce compiler-derived required/optional allowlists against the pinned revision.
Missing required keys fail, absent optional keys are omitted, and undeclared reads or optional-to-required
promotion are denied. Executable targets/OAuth fields use generated dependency facts; normalized
environment-key collisions reject loading. OAuth invalidation is compare-and-set on current run,
connection, token version, and submitted token.

Cache keys are canonical tuples scoped by execution user, tagged plugin/kernel owner, provider ID or
stable script slug, and authored key. Disposable values additionally pin code/config and reset on
backend restart; persistent values omit revision/config pins. `claimPersistentValue` writes only if
absent and survives restart; `getPersistentValue` neither claims nor extends expiry.

Feature services implement host functions beside their owners; `boot/script-host.ts` assembles the
single host map shared by inline and durable dispatch.

## Script Writes

Entity capabilities enforce exact schema, plugin, scope, and user ownership through normal services,
policies, and receipts. Scripts cannot set global scope, provider provenance, ownership, or
`populatedAt`; policies/system subjects cannot use user-entity creation.

| Operation                               | Contract                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `createUserEntity` / `updateUserEntity` | Create one owned entity or update against expected name, time, and properties                                                                   |
| `deleteUserEntity`                      | Delete the owned schema-matching entity through lifecycle handling, including referencing events                                                |
| `saveUserEntity`                        | Atomically save one entity and replace outgoing user relationships for listed schemas; incoming/unlisted schemas remain unchanged               |
| `mergeUserEntityData`                   | Move the user's events/relationships into a same-schema entity using merge policy and return moved counts                                       |
| `updateEvents` / `deleteEvents`         | Atomic batches of at most 100; updates use `{ eventId, patch }` with properties `{ remove, set }`, occurrence time, entity, or nullable session |
| `changeUserRelationships`               | Each create chooses merge (preserve unspecified fields/union arrays) or replace (full property record); membership writes use merge             |

`saveUserEntity` requires owned relationship schemas whose source matches the entity schema. Its
single `entity-editor:save` receipt retains entity ID and dispatch list for crash redispatch. Changed
relationship sets, expected snapshots, or concurrent state return `stale`. Invalid properties/assets,
immutable changes, duplicate targets, over 200 targets, or over 100 changes return `invalid`.
Foreign/missing/unowned entities or schemas fail the call. Writes preserve the sandbox principal,
not kernel collection authority.

Merge requires a user-owned source and same-plugin/schema endpoints. It retains the sandbox principal
but marks the command as a kernel collection command, allowing owned domain events and kernel
review/collection/member-of state to move. Other plugins' events/relationships fail `owner-mismatch`.
All source user relationships move; scripts detach those they do not want first.

Entity, event, and relationship writes accept optional `{ submittedAt, idempotencyKey }`, scoped by
account generation, installation, script, and capability. Retries preserve ordered input/time/key;
changed committed input conflicts. Without options, execution-scoped identities apply. Event update
items may also include an expected entity/time/properties/session snapshot.

Event creation returns count and one indexed outcome per input: written event ID or policy skip.
Partial failures retain count/outcomes/code/partial. Later failures do not roll back earlier committed
operations or weaken their owning services' transaction/lifecycle boundaries.

## Global HTTP Admission

Manifest `httpRateLimits` apply deployment-wide. Origins normalize host/default port/IP/trailing dot;
identical declarations coexist and conflicts reject activation. Persisted manifests are authoritative
and policy is reread after every wait. Limits are live across plugin changes, not pinned authority.

Admission uses execution/request/hop/429-attempt tickets bound to declaration hash, lane, tenant, and
plugin. Re-registering the same binding is idempotent; conflicting bindings fail closed. Redis-time
Lua operations share the policy hash tag. Resolution, registration, polling, and claim use one
deterministic activity per hop; waiting adds no journal/replay entries. Unmatched resolution creates
no ticket. Polling checks pending interruption so the workflow can suspend and apply it; finalizers
cancel the last binding. Block/finalizer cancellation are separate activities. Corrupt ticket data
fails that ticket; corrupt policy state fails closed without refreshing TTL.

The scheduling rules are:

- `poll` renews demand and grants an open slot by lane, tenant ring, plugin ring, then FIFO, scanning
  at most 16 flows before considering the polling ticket. Interactive wins except after four
  interactive claims with background demand. Rings advance only on admitted claims, not skipped
  flows, so plugin fan-out cannot increase tenant share.
- Grant lease is `max(spacing, 1 second)`. Expired unclaimed grants require another poll. Wake hints
  are bounded by spacing/60 seconds and active block time.
- Only a successful `claim` permits network I/O. It rechecks ticket/nonce, declaration, block, and
  spacing, then anchors spacing and retains a ten-minute tombstone for idempotent lost replies.
  Unknown/expired/stale tickets reregister. Startup never clears spacing or blocks.
- Ticket leases run 120 seconds from last poll or block end. Each operation removes at most 16 stale
  tickets and requests retry if cleanup is incomplete. Pending caps are 1,024 per policy, 64 per
  tenant/lane, and 256 for system. Overload backs off 1–30 seconds; keys expire after at least ten
  policy intervals or ten minutes and survive active blocks.
- Only matched HTTP 429s retry automatically: delta/date `Retry-After` or policy interval advances
  the shared block (capped at one hour), then retries durably with a new attempt ticket. Coordination
  failures back off 1–30 seconds, in memory during admission and durably elsewhere. Matched calls
  fail closed while coordination is unavailable; proven unmatched calls continue.

Redirects are manual, at most five. 303 and POST 301/302 become bodyless GETs; credential headers are
removed across origins and scripts cannot set Host. Every hop resolves policy before network access;
matched/unresolved hops hand off for admission, including inline settlement. An IP/alias does not
inherit another hostname's declared limit.

All application HTTP, including notifications/OAuth, passes the
`src/platform/egress/address-policy.ts` checks on every hop. Only HTTP(S) and permitted resolved
addresses are allowed. `SERVER_EGRESS_ALLOWED_NETWORKS` may permit private ranges, never unspecified,
link-local, metadata, multicast, 6to4, or Teredo destinations. Connections use a checked address with
the original Host/TLS name, ignore proxy environment, and return redirects for rechecking. Denial is
certain failure with `data.code: "destination-denied"`.

Metrics expose waits, grants, expiry, and overload by lane/policy/outcome. Logs include only bounded
execution/request/hop/origin/stage/timing/status fields, never full URLs, queries, headers, bodies,
credentials, users, tenants, plugins, or ticket identity.

## Failures

Completed failures identify load/input/execute/output phase and sanitized authored source frames.
Returned stacks omit data URLs, dependencies/runner paths, tokens, and execution IDs. Timeout or
unexpected isolate death is a workflow failure. Diagnostic logs are bounded and replay-tagged;
truncation appends `[sandbox logs truncated]`, while oversized final output fails without partial data.
Results include `timing: { totalMs, executionMs }`.

Missing retained artifacts and invalid projections are distinct preparation failures; neither falls
back to full evidence. Normal APIs/persisted workflows use structured kebab-case reasons. Raw
diagnostics belong only to explicit author/admin/test surfaces; unexpected causes stay in logs.

## Liveness And Pruning

The [garbage collector](../garbage-collection/README.md) uses persisted liveness under the ingestion
fence. Current revisions, source-zero scripts, active workflows, and retained automation pins protect
their artifacts. Completion/cancellation releases workflow references. Pruning deletes unreferenced
database rows transactionally, not compiled caches/files.
