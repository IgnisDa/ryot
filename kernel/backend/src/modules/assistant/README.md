# Assistant

## Conversation persistence

`AssistantRepository.layer` requires `DatabaseSession`. Services own transactions: every mutation
requires an active transaction, acquires the conversation row lock first, and never holds a lock
across model or tool execution. Account deletion cascades through conversations, turns, messages,
calls and the provider override. Account reset assembly must delete conversations and provider
settings alongside other user data.

The repository exports:

- `renameConversation(userId, conversationId, title)`.
- `deleteConversation(userId, conversationId)` rejects any active (queued, running,
  awaiting-approval or awaiting-input) turn.
- `submit(userId, { conversationId?, requestId, text })` → persisted turn. Without a conversation ID
  it creates one titled from the message's first 60 characters. Request IDs are unique per user
  across turns and queued messages: reusing one replays it, and changing its text or conversation
  fails. While a turn is active, a new request is queued for it in `assistant_inbox` and the active
  turn is returned; the service starts a workflow only for a returned turn with the same request ID.
- `interrupt(userId, conversationId, turnId)` → `{ turn, next, awaitingDecision }`. Stops an active
  turn, gives every unfinished call the inert `{ interrupted: true }` result (tool calls also get a
  tool-result message so later prompts stay paired), and returns the calls whose approval or
  question deferreds the service must complete with a decline. Queued messages not yet delivered
  become one `next` queued turn, which the service starts.
- `transition(userId, conversationId, turnId, expectedRevision, status, failure?)` → updated turn.
  Status is `running`, `completed`, `failed` or `interrupted`. Completion and starting another model
  round require every previous call to have a result.
- `setRoundText(userId, conversationId, turnId, round, text)` → updated turn. Replaces the
  deterministic text message for an unfinished round; empty text stores no message and removes a
  previous one. Committed rounds are immutable. The caller
  omits this text from `recordRound`.
- `recordRound(userId, conversationId, turnId, expectedRevision, { text, calls, parts? })` → updated
  turn. Stores the completed model round's tool calls with immutable arguments; `parts` may carry
  revision-bound page previews. Approval-requiring calls pause the turn in `awaiting-approval`, and
  otherwise `question` calls pause it in `awaiting-input`.
- `recordCapabilityCall(userId, conversationId, turnId, expectedRevision, call)` → updated turn.
  Stores an approval-requiring capability write requested by an unfinished `execute` call, with the
  pinned capability, and pauses the turn. Recording the same call ID again is a no-op.
- `settleCapabilityCall(userId, conversationId, turnId, expectedRevision, toolCallId, result)` →
  updated turn. Stores a decided capability write's outcome without appending a message.
- `decide(userId, { conversationId, turnId, toolCallId, expectedRevision, decision })` → updated
  call. Here `expectedRevision` fences the **call**, not the turn. The same decision replays; a
  competing decision fails. Persisting a decision also advances the turn revision.
- `answer(userId, { conversationId, turnId, toolCallId, answers })` stores one answer per question as
  an unanswered `question` call's result while the turn awaits input. The same answers replay;
  different ones fail with `decision-conflict`, and a wrong count with `answer-invalid`.
- `recordResult(userId, conversationId, turnId, expectedRevision, toolCallId, result, parts?, output?)`
  → updated turn. Requires a recorded decision for approval-requiring calls. The service supplies the
  declined result without dispatching the tool. The result uses the shared `AgentToolResult`
  envelope; a `retained` result must come with its full `output`, stored in `assistant_tool_output`
  under the result's `outputId` in the same transaction. Capability writes of that call still without
  a result are marked not executed.
- `readOutput(userId, conversationId, outputId)` → stored output text or `null`.
- `deliverInbox(userId, conversationId, turnId, expectedRevision)` appends the turn's queued messages
  as user messages in arrival order and marks them delivered.
- `complete(userId, conversationId, turnId, expectedRevision)` → turn with `completed`. It completes
  the turn only when no queued message waits for it, so a message arriving during the final round is
  delivered by another round instead of being dropped.
- `appendTurnMessage(userId, conversationId, turnId, expectedRevision, { id, role, parts })` appends a
  message once per ID, for compaction summaries and continuation instructions.
- `recordPromptUsage(userId, conversationId, { tokens, characters })` stores the provider's measured
  prompt size for token estimates.
- `loadTurn(userId, turnId)` → `{ turn, messages, calls, measurement } | null`. Messages contain the
  entire conversation in sequence order; calls contain this turn's pinned calls in round/position
  order; `measurement` is the last recorded prompt usage.
- `recoverableTurns` (an Effect) → active rows for trusted workflow recovery.

Turn mutations fence the expected turn revision. A revision conflict means reload persisted state;
never dispatch a tool based on an uncommitted decision. Provider runtime persistence is owned by its
separate repository; `assistantProvider.encryptedApiKey` stores the existing `SubkeyCiphertext`
envelope, and provider rows have no RyotQL catalog binding. The loop must use stable call-based
idempotency keys for external side effects.

The kernel-only owner-scoped catalog exposes `assistantConversation`, `assistantMessage`,
`assistantTurn`, `assistantToolCall` and `assistantInbox`. A conversation's `status` is computed from its latest turn,
so it needs no maintenance and restored history reports it correctly. It exposes neither provider keys nor provider settings.
Read access and demo write approval restrictions remain service responsibilities.

Terminal failures use `AssistantTurnFailure` codes (`provider-unavailable`, `provider-failed`,
`request-limit`, `tool-failed`, `execution-failed`), never provider diagnostic prose. Services must use
account mutation admission before entering these transactions, including during workflow recovery,
so account disable/reset and queued work obey the shared lifecycle rules.

## Provider configuration and model streaming

`AssistantProviderConfiguration.layer` composes the provider repository and the existing persisted
configuration encryption-key service; it requires `DatabaseSession`, `AppConfig` and `SecureRandom`.
`configure(userId, accessClass, body)` and `remove(userId, accessClass)` reject demo sessions, take
the user's write lock, and admit the account inside their transaction. `metadata(userId)` returns
only the effective base URL, model, context window, output limit, source and key presence, or
`null`. This is computed status,
not a provider-row read API. The internal `effective(userId)` additionally returns a redacted key.

A user override replaces the whole instance provider, including its authentication. Omitting
`apiKey` on a configuration write retains that user's prior encrypted key; a first keyless write
uses no authentication. The optional context window and output limit default to 496,000 and 32,000
tokens, from the instance settings or a user's override; the output limit must be below the window.
Removing the override deletes its key and falls back to the instance provider. To clear a key while retaining a keyless override, remove the override then configure it
again without a key. Instance defaults require both `SERVER_ASSISTANT_BASE_URL` and
`SERVER_ASSISTANT_MODEL`; `SERVER_ASSISTANT_API_KEY` is optional. Base URLs include the API prefix
(such as `/v1`) and cannot contain credentials, a query or a fragment.

Keys use the existing `SubkeyCiphertext` envelope, dedicated HKDF context
`ryot/assistant/provider-api-key`, and authenticated user attribution. The shared encryption-key
retention check includes assistant ciphertext; missing or mismatched keys fail closed rather than
replacing a key needed by retained data. Copying ciphertext to another user fails authentication.
Provider keys do not appear in metadata, RyotQL, model events or errors.

`AssistantModel.live` provides the model through `EgressHttpClientLive`. `AssistantModel.layer`
requires an injected `HttpClient` for transport tests; workflow tests can instead inject the
`AssistantModel` service directly. `stream({ provider, prompt, tools, maxOutputTokens })` yields typed
`AssistantModelEvent` values: text deltas, reasoning deltas with the response field that carried
them (`reasoning` or `reasoning_content`), complete JSON tool calls preserving `modelCallId`, and
finish reasons with the provider's measured prompt tokens when it reports usage. It uses `@effect/ai-openai-compat` `OpenAiClient` and `OpenAiLanguageModel` with
Effect `LanguageModel` streaming. The adapter handles Chat Completions and fragmented tool
arguments. Tool resolution is disabled and validation deferred, leaving argument validation,
approvals, dispatch, retry and round policy to the durable workflow. Provider-executed calls fail.
`assistantProviderPrompt(system, summary, messages)` converts persisted text, reasoning, model tool
calls and results to an Effect prompt using the original provider call IDs; UI approval and preview
parts and capability writes are omitted. A compaction summary becomes a leading user message,
instruction parts become user text, and a retained result becomes its head, a marker naming its
`outputId` and its tail, rendered from the stored result so restored IDs stay correct. Consecutive assistant messages, a round's streamed text and its
recorded calls, become one provider message, and reasoning is replayed in its original field because
thinking-mode providers reject tool-call follow-ups without it. Each round stores its reasoning as a
`reasoning` part beside its tool calls.

A request fails if the stream sends nothing for two minutes. Retryable provider failures (rate
limits, server errors and transport failures) are retried up to four times with jittered backoff
that honors `Retry-After`, but only before any event was emitted. A rejected prompt that the
provider reports as too long fails with `context-overflow`; other failures become
`provider-failed`. Errors carry fixed codes without response bodies or diagnostics. Provider tracing
is disabled to keep SDK error and response data out of spans. Egress restrictions apply to every
request; local endpoints require an explicit `SERVER_EGRESS_ALLOWED_NETWORKS` allowance.

## Durable turn loop

`AssistantService` admits one active turn per conversation in a caller transaction, then dispatches
`AssistantTurnWorkflow` with the account identity and turn ID. Request IDs replay the existing turn
or queued message and reject changed text. A message sent while a turn is active is queued for it. The boot recovery pass dispatches admitted queued turns that committed
before workflow admission. The PostgreSQL workflow engine separately restores running and waiting
executions. Payloads contain no session credentials; each activity resolves the current trusted
account and every persistence transaction uses account mutation admission. Account reset removes
conversations, provider overrides and account-owned workflow executions.

Each model round is an activity. Text batches update one deterministic message for that round;
restarting an unfinished model request replaces that message instead of appending replayed deltas.
The completed round, including validated call arguments, enters the workflow journal before its
immutable calls are committed or dispatched. Calls have stable turn/round/position identities and
call-based owner replay keys. Consecutive read-only calls that need no approval run concurrently;
every other call runs alone, in the order the model gave. The [agent tools](../agent-tools/README.md)
registry decides which tools require call approval (`page_publish`) and revalidates
that requirement before dispatch; a changed requirement refuses the call.

`execute` writes are approved one at a time. Trusted turns have `confirm` write access, so the
agent tools use the turn's confirmation gate for every write. That gate records each write as a
capability call (ID `<execute call>:write:<host call index>`) and suspends the execution; the
workflow awaits that call's decision and dispatches the same `execute` call again, which replays its
settled host calls and resumes at the write. An approved write dispatches only if the pinned
capability still matches the current catalog; declined or changed writes throw inside the code.
Each write's outcome is stored on its capability call.

A decision commits before its durable deferred is completed. Workflow replay reads the persisted
decision, covering a process exit between those operations. Duplicate decisions replay; competing
and stale decisions fail. Declines persist a tool result without dispatch. Page publication and every
`execute` write require approval; private page drafts do not. Demo accounts cannot decide, save
pages or change provider settings. Agent-script replay is owned by its persisted journal.

A valid `question` call waits on the same durable deferred as an approval. `answer` commits the
answers as the call's result, then completes the deferred; the workflow skips a call that already has
a result. `todo` records nothing beyond its call, whose latest arguments the transcript shows as the
plan, and `read_result` reads the conversation's stored output by line range or pattern. These
Ryo-only tools live in `local-tools.ts` and never reach MCP.

Stopping a turn commits the interruption first, then completes each waiting approval or question
deferred with a decline, and starts the turn built from undelivered queued messages. The workflow observes the terminal status at its next step: streaming refuses to persist
more round text, settled calls are not dispatched, the next round returns no calls and finishing is a
no-op. A tool already running when the user stops finishes, but its result is not recorded.

The loop has no round or call limit. It ends when a round makes no calls and was not cut off, and
`complete` finds no queued message; failure appends any queued messages to the history. Each round
first delivers queued messages, then replays the whole conversation from the latest compaction:
every turn's text and tool traffic, and the current turn's reasoning (`context.ts`). The system
prompt has fixed sections plus a section with each ready, visible plugin's
`client.assistantInstructions`.

Prompt size is estimated from its characters, scaled by the last measured tokens per character
(3.5 characters per token before any measurement). When the estimate passes the context window
minus a reserve of 15% (at least 16,000 tokens), older message groups are compacted: the same model,
offered no tools, summarizes them under fixed headings, splitting the input in half and retrying if
the summary request overflows. The newest groups within about 15,000 tokens stay verbatim, and a
tool call never separates from its results. The summary is stored as a `compaction` part recording
the last summarized sequence; the full history stays stored and visible. A round compacts at most
once: an overflow reported by the provider compacts everything but the newest group and retries,
and a request that still does not fit, or leaves under 1,024 tokens for output, fails with
`request-limit`. Each request asks for the configured output limit, reduced to the room left in the
window.

A reply cut off at the output limit keeps its partial text, and the next round adds a user
instruction to continue where it stopped. Tools may return up to 8 MiB. Results over 50 KiB or 2,000
lines are stored whole in `assistant_tool_output` and recorded as `retained`, with a 24 KiB head and
8 KiB tail for the model. Provider failures are logged by code and persist only public failure codes.
Compiler failures instead become repair results containing the actual build diagnostics.

Successful `page_write` calls persist a `page-preview` beside the tool result in the same
transaction. `AssistantSavePage` verifies that the caller's selected turn contains the exact preview
identity and that the current compiled draft still matches. Save pins the complete command input,
then publishes through page authoring and creates a page saved view through its owner, using stable
independent replay keys. A retry after publication succeeds reuses that publication and view receipt.
A completed Save replays its result even if the draft changes later. Share uses the existing client
publication manager.

All turn changes publish transaction-bound `assistant-updated` hints containing the conversation,
turn and revision. The live-update hub sends them only to the owning user's streams. These are
invalidation hints: clients read canonical messages and recover on reconnect rather than applying
text deltas from the transport.

HTTP routes call the assistant, provider configuration and Save owners. Feature Layers compose the
registry, provider, page and saved-view services; boot registers runtime workflows before recovering
queued admissions and opening the HTTP listener.

## Backups

Account backups retain conversations, ordered messages, turn history, pinned calls, approval
decisions, results and stored tool outputs through the
[backup pipeline](../backups/README.md#assistant-history). Restored retained results and their
outputs move to the restored call IDs. Queued messages and prompt measurements are not exported.
Restore remaps owner and typed record/page identities and interrupts formerly active turns.
Unfinished calls receive inert interrupted results, so approved or undecided history cannot execute;
capability writes keep their parent call and receive no tool-result message.
Opaque text and tool payloads remain unchanged. Historical draft previews need preparation again,
because backups omit draft artifacts and compiled markers; deleted page previews become unavailable
text. No workflow, wake or provider execution is restored.

User provider URL, model and limit overrides are portable, but API keys are always redacted. Re-enter a
restored provider's key in Settings → Ryo. Ciphertext is never copied across users, and instance
provider settings and credentials are never exported. Existing history or a provider override makes
an account ineligible as a clean restore destination.
