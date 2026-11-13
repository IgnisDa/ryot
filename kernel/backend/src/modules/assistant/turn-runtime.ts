import {
	AssistantError,
	AssistantLocalToolName,
	type AssistantMessage,
	type AssistantMessagePart,
	AssistantQuestionInput,
	AssistantReasoningField,
	AssistantTodoInput,
	AssistantToolCall,
	AssistantToolName,
	type AssistantTurnFailure,
} from "@ryot-app/contract/modules/assistant/schemas";
import { AssistantToolCallId, type UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Option, Result, Schema, Stream } from "effect";

import { AuthService } from "#modules/accounts/auth/service";
import { capabilityPin } from "#modules/agent-tools/catalog";
import type { WriteGate, WriteRequest } from "#modules/agent-tools/execute";
import { AgentToolsService } from "#modules/agent-tools/service";
import { publishAssistantUpdated } from "#modules/live-updates/publish";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { AgentRunSuspended } from "#modules/scripts/agent/service";
import { DatabaseSession } from "#platform/db/session";
import { truncateJsonResult } from "#platform/tool-result";

import {
	activeHistory,
	ASSISTANT_COMPACTION_KEEP_TOKENS,
	compactionSplit,
	compactionThreshold,
	estimateTokens,
} from "./context";
import {
	assistantLocalTools,
	PRODUCER_OUTPUT_BYTES,
	ReadResultInput,
	readStoredOutput,
	retainToolResult,
} from "./local-tools";
import { type AssistantProvider, AssistantProviderConfiguration } from "./provider-configuration";
import {
	AssistantModel,
	AssistantModelError,
	type AssistantModelEvent,
	type AssistantModelRequest,
	assistantProviderPrompt,
} from "./provider-model";
import { AssistantRepository } from "./repository";

export const AssistantRound = Schema.Struct({
	continued: Schema.Boolean,
	calls: Schema.Array(AssistantToolCall),
	reasoning: Schema.NullOr(Schema.Struct({ text: Schema.String, field: AssistantReasoningField })),
});
export type AssistantRound = typeof AssistantRound.Type;
export type AssistantTurnPayload = { readonly userId: UserId; readonly turnId: string };

const failure = (code: AssistantTurnFailure["code"]): AssistantTurnFailure => ({ code });
const toolFailure = (error: { readonly message: string }): AgentToolResult =>
	truncateJsonResult({
		error: "tool-failed",
		message: error.message,
		instruction: "The call was refused or failed. Correct it or ask for approval again if needed.",
	});
const assistantSystemPrompt = [
	"You are Ryo, the assistant inside Ryot, an app where people track and analyze parts of their life such as media, fitness and other data that installed plugins describe.",
	"Work from the user's real data. Inspect it with tools instead of guessing, and keep working until the request is fully handled. Find capabilities with search, then run them with execute; combine related calls in one execute and return only the fields you need.",
	"Large tool outputs are stored and shown as a preview with an outputId; read more of them with read_result instead of repeating the call.",
	"Every write through execute and every page publication requires user approval. Page drafts do not, because they stay private until the user saves them. Never claim a declined or failed call succeeded.",
	"Before building a page, read the pages documentation with read_docs. Create a page with page_write, then inspect it with page_read and change it with page_edit, repairing compiler diagnostics until the preview succeeds. The user saves a previewed draft, which publishes it and creates a saved view; sharing uses the publication UI. Call read_docs without a topic to list documentation.",
	"Reply concisely, and say plainly what you could not find or finish.",
].join("\n\n");
const collectText = (stream: Stream.Stream<AssistantModelEvent, AssistantModelError>) =>
	Effect.gen(function* () {
		let text = "";
		yield* Stream.runForEach(stream, (event) =>
			Effect.sync(() => {
				if (event.type === "text-delta") {
					text += event.text;
				}
			}),
		);
		return text;
	});
const continueInstruction =
	"Your previous response reached the output limit and was cut off. Continue exactly where it stopped, without repeating what you already wrote.";
const summarySystemPrompt =
	"You condense the earlier part of a conversation between a user and Ryo, the assistant inside Ryot, so Ryo can continue the work without it. Keep every fact Ryo still needs: identifiers (capability, entity, page and output IDs, draft revisions), data found, decisions, the user's preferences and instructions, and work that is unfinished or failed. Leave out pleasantries and repeated content.";
const summaryRequest =
	"Summarize the conversation above under these headings: Goal, Facts and data found, Work done, Open work, User instructions. Use short bullet points.";
const OUTPUT_MARGIN_TOKENS = 1_000;
const MIN_OUTPUT_TOKENS = 1_024;
const terminalStatuses = new Set(["failed", "completed", "interrupted"]);
const textId = (turnId: string, round: number) => `${turnId}:round:${round}:text`;
const continuationId = (turnId: string, round: number) => `${turnId}:round:${round}:continue`;
const localModelTools = Object.values(assistantLocalTools).map(({ name, input, description }) => ({
	name,
	input,
	description,
}));

export const makeAssistantTurnRuntime = Effect.fn(function* ({
	tools,
	model,
	providers,
	checkAccount,
}: {
	readonly model: AssistantModel["Service"];
	readonly providers: Pick<AssistantProviderConfiguration["Service"], "effective">;
	readonly tools: Pick<
		AgentToolsService["Service"],
		"listTrusted" | "callTrusted" | "validateTrusted"
	>;
	readonly checkAccount: (
		userId: UserId,
	) => Effect.Effect<
		void,
		Effect.Error<ReturnType<AuthService["Service"]["resolveTrustedAccount"]>>
	>;
}) {
	const repository = yield* AssistantRepository;
	const session = yield* DatabaseSession;
	const admission = yield* AccountAdmission.make;
	const transact = <A, E, R>(userId: UserId, effect: Effect.Effect<A, E, R>) =>
		session.transaction(
			Effect.gen(function* () {
				yield* checkAccount(userId);
				yield* admission.admitAccount(userId);
				return yield* effect;
			}),
		);
	const load = Effect.fn(function* ({ userId, turnId }: AssistantTurnPayload) {
		yield* checkAccount(userId);
		const state = yield* repository.loadTurn(userId, turnId);
		if (!state) {
			return yield* new AssistantError({ reason: { code: "turn-not-found" } });
		}
		return state;
	});
	const write = <A extends { id: string; revision: number; conversationId: string }, E, R>(
		userId: UserId,
		effect: Effect.Effect<A, E, R>,
	) =>
		transact(
			userId,
			effect.pipe(
				Effect.tap((turn) =>
					publishAssistantUpdated(userId, turn.conversationId, turn.id, turn.revision).pipe(
						Effect.provideService(DatabaseSession, session),
					),
				),
			),
		);
	const latest = <A, E, R>(
		payload: AssistantTurnPayload,
		effect: (turn: {
			readonly revision: number;
			readonly conversationId: string;
		}) => Effect.Effect<A, E, R>,
	) =>
		load(payload).pipe(
			Effect.flatMap((state) => effect(state.turn)),
			Effect.retry({
				times: 32,
				while: (error) => error instanceof AssistantError && error.reason.code === "revision-stale",
			}),
		);
	/** Fails with `"context-overflow"` only when the provider rejected the prompt before producing output. */
	const streamRound = Effect.fn("AssistantTurnRuntime.streamRound")(function* (
		payload: AssistantTurnPayload,
		state: Effect.Success<ReturnType<typeof load>>,
		round: number,
		request: AssistantModelRequest,
	) {
		let text = "";
		let reasoning: AssistantRound["reasoning"] = null;
		let persistedLength = -1;
		let inputTokens: number | undefined;
		const finishReasons: string[] = [];
		const calls: AssistantToolCall[] = [];
		const persistText = Effect.fn(function* () {
			if (text.length === persistedLength) {
				return undefined;
			}
			yield* write(
				payload.userId,
				repository.setRoundText(
					payload.userId,
					state.turn.conversationId,
					payload.turnId,
					round,
					text,
				),
			);
			persistedLength = text.length;
			return undefined;
		});
		yield* model.stream(request).pipe(
			Stream.runForEach(
				Effect.fn(function* (event) {
					if (event.type === "text-delta") {
						text += event.text;
						if (text.length - persistedLength >= 512) {
							yield* persistText();
						}
					} else if (event.type === "reasoning-delta") {
						reasoning = { field: event.field, text: (reasoning?.text ?? "") + event.text };
					} else if (event.type === "tool-call") {
						if (
							calls.some(
								(candidate) =>
									candidate.kind === "tool" && candidate.modelCallId === event.modelCallId,
							)
						) {
							return yield* Effect.fail(failure("provider-failed"));
						}
						if (!Schema.is(AssistantToolName)(event.name)) {
							yield* Effect.logWarning("Assistant model called an unknown tool", {
								tool: event.name,
							});
							return yield* Effect.fail(failure("provider-failed"));
						}
						const name = event.name;
						const requiresApproval = Schema.is(AssistantLocalToolName)(name)
							? false
							: yield* tools
									.validateTrusted(payload.userId, { name, arguments: event.arguments })
									.pipe(
										Effect.map((validated) => validated.requiresApproval),
										Effect.catchTag(["BadRequest", "DemoOperationProtected"], () =>
											Effect.succeed(false),
										),
									);
						calls.push({
							tool: name,
							kind: "tool",
							requiresApproval,
							arguments: event.arguments,
							modelCallId: event.modelCallId,
							id: AssistantToolCallId.make(`${payload.turnId}:${round}:${calls.length}`),
						});
					} else {
						finishReasons.push(event.reason);
						inputTokens = event.inputTokens ?? inputTokens;
					}
					return undefined;
				}),
			),
			Effect.tapError((error) =>
				Effect.logWarning("Assistant model request failed", {
					error: "code" in error ? error.code : String(error),
				}),
			),
			Effect.mapError((error) =>
				error instanceof AssistantModelError && error.code === "context-overflow"
					? ("context-overflow" as const)
					: failure("provider-failed"),
			),
		);
		const truncated = finishReasons.includes("length");
		if (
			!truncated &&
			!finishReasons.some((reason) => reason === "stop" || reason === "tool-calls")
		) {
			yield* Effect.logWarning("Assistant model stream ended without a usable finish reason", {
				finishReasons,
			});
			return yield* Effect.fail(failure("provider-failed"));
		}
		yield* persistText();
		return { calls, reasoning, truncated, inputTokens };
	});
	const summarize = (
		provider: AssistantProvider,
		previous: null | string,
		groups: ReadonlyArray<ReadonlyArray<Pick<AssistantMessage, "role" | "parts">>>,
	): Effect.Effect<string, AssistantTurnFailure> =>
		collectText(
			model.stream({
				provider,
				tools: [],
				maxOutputTokens: provider.maxOutputTokens,
				prompt: assistantProviderPrompt(summarySystemPrompt, previous, [
					...groups.flat(),
					{ role: "user", parts: [{ kind: "text", text: summaryRequest }] },
				]),
			}),
		).pipe(
			Effect.catch((error) => {
				if (error.code === "context-overflow" && groups.length > 1) {
					const half = Math.ceil(groups.length / 2);
					return summarize(provider, previous, groups.slice(0, half)).pipe(
						Effect.flatMap((first) => summarize(provider, first, groups.slice(half))),
					);
				}
				return Effect.fail(
					failure(error.code === "context-overflow" ? "request-limit" : "provider-failed"),
				);
			}),
		);
	const compact = Effect.fn("AssistantTurnRuntime.compact")(function* (
		payload: AssistantTurnPayload,
		state: Effect.Success<ReturnType<typeof load>>,
		provider: AssistantProvider,
		keepTokens: number,
	) {
		const history = activeHistory(state.messages, payload.turnId);
		const older = compactionSplit(
			history.messages,
			(messages) =>
				estimateTokens(
					stableStringify(messages.map(({ parts }) => parts)).length,
					state.measurement,
				),
			keepTokens,
		);
		const throughSequence = older?.flat().at(-1)?.sequence;
		if (older === null || throughSequence === undefined) {
			return false;
		}
		const summary = yield* summarize(provider, history.summary, older);
		yield* latest(payload, (turn) =>
			write(
				payload.userId,
				repository.appendTurnMessage(
					payload.userId,
					turn.conversationId,
					payload.turnId,
					turn.revision,
					{
						role: "assistant",
						id: `${payload.turnId}:compaction:${throughSequence}`,
						parts: [{ summary, throughSequence, kind: "compaction" }],
					},
				),
			),
		);
		return true;
	});
	const generate = Effect.fn("AssistantTurnRuntime.generate")(function* (
		payload: AssistantTurnPayload,
		round: number,
	) {
		let state = yield* load(payload);
		if (state.turn.round >= round) {
			return {
				reasoning: null,
				calls: state.calls.filter((call) => call.round === round).map((call) => call.call),
				continued: state.messages.some(
					(message) => message.id === continuationId(payload.turnId, round),
				),
			};
		}
		if (terminalStatuses.has(state.turn.status)) {
			return { calls: [], reasoning: null, continued: false };
		}
		if (state.turn.status === "queued") {
			yield* write(
				payload.userId,
				repository.transition(
					payload.userId,
					state.turn.conversationId,
					payload.turnId,
					state.turn.revision,
					"running",
				),
			);
		}
		yield* latest(payload, (turn) =>
			write(
				payload.userId,
				repository.deliverInbox(payload.userId, turn.conversationId, payload.turnId, turn.revision),
			),
		);
		state = yield* load(payload);
		const provider = yield* providers
			.effective(payload.userId)
			.pipe(Effect.mapError(() => failure("provider-unavailable")));
		if (!provider) {
			return yield* Effect.fail(failure("provider-unavailable"));
		}
		const available = [...(yield* tools.listTrusted(payload.userId)), ...localModelTools];
		let compacted = false;
		for (;;) {
			const history = activeHistory(
				state.messages.filter((message) => message.id !== textId(payload.turnId, round)),
				payload.turnId,
			);
			const prompt = assistantProviderPrompt(
				assistantSystemPrompt,
				history.summary,
				history.messages,
			);
			const characters = stableStringify([prompt, available]).length;
			const estimate = estimateTokens(characters, state.measurement);
			if (!compacted && estimate > compactionThreshold(provider.contextWindow)) {
				compacted = true;
				if (yield* compact(payload, state, provider, ASSISTANT_COMPACTION_KEEP_TOKENS)) {
					state = yield* load(payload);
					continue;
				}
			}
			const maxOutputTokens = Math.min(
				provider.maxOutputTokens,
				provider.contextWindow - estimate - OUTPUT_MARGIN_TOKENS,
			);
			if (maxOutputTokens < MIN_OUTPUT_TOKENS) {
				return yield* Effect.fail(failure("request-limit"));
			}
			const streamed = yield* streamRound(payload, state, round, {
				prompt,
				provider,
				maxOutputTokens,
				tools: available,
			}).pipe(Effect.result);
			if (Result.isFailure(streamed)) {
				if (streamed.failure === "context-overflow") {
					if (!compacted) {
						compacted = true;
						if (yield* compact(payload, state, provider, 0)) {
							state = yield* load(payload);
							continue;
						}
					}
					return yield* Effect.fail(failure("request-limit"));
				}
				return yield* Effect.fail(streamed.failure);
			}
			if (streamed.success.inputTokens !== undefined) {
				const tokens = streamed.success.inputTokens;
				yield* transact(
					payload.userId,
					repository.recordPromptUsage(payload.userId, state.turn.conversationId, {
						tokens,
						characters,
					}),
				);
			}
			return {
				calls: streamed.success.calls,
				reasoning: streamed.success.reasoning,
				continued: streamed.success.truncated && streamed.success.calls.length === 0,
			};
		}
	});
	const recordRound = Effect.fn("AssistantTurnRuntime.recordRound")(function* (
		payload: AssistantTurnPayload,
		round: number,
		result: AssistantRound,
	) {
		const state = yield* load(payload);
		if (terminalStatuses.has(state.turn.status)) {
			return;
		}
		if (state.turn.round < round) {
			yield* write(
				payload.userId,
				repository.recordRound(
					payload.userId,
					state.turn.conversationId,
					payload.turnId,
					state.turn.revision,
					{
						text: "",
						calls: result.calls,
						parts: result.reasoning ? [{ kind: "reasoning", ...result.reasoning }] : [],
					},
				),
			);
		}
		if (result.continued) {
			yield* latest(payload, (turn) =>
				write(
					payload.userId,
					repository.appendTurnMessage(
						payload.userId,
						turn.conversationId,
						payload.turnId,
						turn.revision,
						{
							role: "user",
							id: continuationId(payload.turnId, round),
							parts: [{ kind: "instruction", text: continueInstruction }],
						},
					),
				),
			);
		}
	});
	const isActive = Effect.fn(function* (payload: AssistantTurnPayload) {
		const state = yield* load(payload);
		return ["queued", "running", "awaiting-approval", "awaiting-input"].includes(state.turn.status);
	});

	const decision = Effect.fn("AssistantTurnRuntime.decision")(function* (
		payload: AssistantTurnPayload,
		callId: string,
	) {
		const state = yield* load(payload);
		const call = state.calls.find((candidate) => candidate.id === callId);
		if (!call) {
			return yield* new AssistantError({ reason: { code: "tool-call-not-found" } });
		}
		if (["failed", "completed", "interrupted"].includes(state.turn.status)) {
			return "decline";
		}
		return call.decision ?? (call.result === null ? null : "approve");
	});
	const gate = (payload: AssistantTurnPayload, parentId: AssistantToolCallId): WriteGate => {
		const childId = (index: number) => AssistantToolCallId.make(`${parentId}:write:${index}`);
		const settle = (index: number, value: JsonValue) =>
			latest(payload, (turn) =>
				write(
					payload.userId,
					repository.settleCapabilityCall(
						payload.userId,
						turn.conversationId,
						payload.turnId,
						turn.revision,
						childId(index),
						truncateJsonResult(value),
					),
				),
			);
		const authorize = (request: WriteRequest) =>
			Effect.gen(function* () {
				const state = yield* load(payload).pipe(Effect.orDie);
				const child = state.calls.find((candidate) => candidate.id === childId(request.index));
				if (!child) {
					yield* latest(payload, (turn) =>
						write(
							payload.userId,
							repository.recordCapabilityCall(
								payload.userId,
								turn.conversationId,
								payload.turnId,
								turn.revision,
								{
									parentId,
									kind: "capability",
									requiresApproval: true,
									arguments: request.input,
									id: childId(request.index),
									hostCallIndex: request.index,
									capability: request.capability,
								},
							),
						),
					).pipe(Effect.orDie);
					return yield* new AgentRunSuspended();
				}
				if (child.decision === null) {
					return yield* new AgentRunSuspended();
				}
				if (child.call.kind !== "capability" || child.decision === "decline") {
					if (child.result === null) {
						yield* settle(request.index, { declined: true }).pipe(Effect.orDie);
					}
					return { approved: false, reason: "The user declined this write" } as const;
				}
				if (capabilityPin(child.call.capability) !== capabilityPin(request.capability)) {
					if (child.result === null) {
						yield* settle(request.index, { error: "capability-changed" }).pipe(Effect.orDie);
					}
					return {
						approved: false,
						reason: "The capability changed after approval; call it again to request approval",
					} as const;
				}
				return { approved: true } as const;
			});
		return {
			authorize,
			settle: (request, outcome) =>
				settle(
					request.index,
					outcome.state === "success" ? outcome.value : { error: outcome.message },
				).pipe(Effect.orDie),
		};
	};
	const readResult = Effect.fn("AssistantTurnRuntime.readResult")(function* (
		payload: AssistantTurnPayload,
		conversationId: string,
		value: JsonValue,
	) {
		const input = yield* Schema.decodeUnknownEffect(ReadResultInput)(value).pipe(Effect.option);
		if (Option.isNone(input)) {
			return toolFailure({ message: "read_result needs an outputId and valid offset or limit" });
		}
		const text = yield* repository.readOutput(payload.userId, conversationId, input.value.outputId);
		if (text === null) {
			return toolFailure({ message: "No stored output in this conversation has that outputId" });
		}
		return yield* Effect.try({
			try: () => truncateJsonResult(readStoredOutput(text, input.value)),
			catch: () => toolFailure({ message: "The pattern is not a valid regular expression" }),
		}).pipe(Effect.catch(Effect.succeed));
	});
	const dispatch = Effect.fn("AssistantTurnRuntime.dispatch")(function* (
		payload: AssistantTurnPayload,
		callId: string,
	) {
		const state = yield* load(payload);
		const stored = state.calls.find((candidate) => candidate.id === callId);
		if (!stored) {
			return yield* new AssistantError({ reason: { code: "tool-call-not-found" } });
		}
		const call = stored.call;
		if (
			call.kind !== "tool" ||
			stored.result !== null ||
			!["queued", "running", "awaiting-approval", "awaiting-input"].includes(state.turn.status)
		) {
			return null;
		}
		if (call.requiresApproval && stored.decision === null) {
			return yield* new AssistantError({ reason: { code: "turn-not-active" } });
		}
		const parts: AssistantMessagePart[] = [];
		let result: AgentToolResult;
		let output: null | string = null;
		if (stored.decision === "decline") {
			result = truncateJsonResult({ declined: true });
		} else if (call.tool === "read_result") {
			result = yield* readResult(payload, state.turn.conversationId, call.arguments);
		} else if (call.tool === "todo") {
			result = Schema.is(AssistantTodoInput)(call.arguments)
				? truncateJsonResult({ updated: true })
				: toolFailure({ message: "todo needs items, each with content and a status" });
		} else if (call.tool === "question") {
			if (Schema.is(AssistantQuestionInput)(call.arguments)) {
				return callId;
			}
			result = toolFailure({
				message: "question needs 1 to 4 questions, each with question text and optional options",
			});
		} else {
			const input = {
				name: call.tool,
				arguments: call.arguments,
				confirm: gate(payload, call.id),
				byteBudget: PRODUCER_OUTPUT_BYTES,
				idempotencyKey: `assistant:${payload.turnId}:${call.id}`,
			};
			const outcome = yield* Effect.gen(function* () {
				const validated = yield* tools.validateTrusted(payload.userId, input);
				if (validated.requiresApproval !== call.requiresApproval) {
					return {
						state: "completed" as const,
						result: toolFailure({ message: "The tool's approval requirement changed" }),
					};
				}
				return yield* tools.callTrusted(payload.userId, input);
			}).pipe(
				Effect.catch((error) =>
					Effect.succeed({ result: toolFailure(error), state: "completed" as const }),
				),
			);
			if (outcome.state === "suspended") {
				const pending = (yield* load(payload)).calls.find(
					(candidate) =>
						candidate.call.kind === "capability" &&
						candidate.call.parentId === call.id &&
						candidate.result === null,
				);
				if (!pending) {
					return yield* Effect.die("Suspended execution has no pending write");
				}
				return pending.call.id;
			}
			({ result, output } = retainToolResult(outcome.result, call.id));
			if ("preview" in outcome) {
				parts.push({ kind: "page-preview", ...outcome.preview });
			}
		}
		yield* latest(payload, (turn) =>
			write(
				payload.userId,
				repository.recordResult(
					payload.userId,
					turn.conversationId,
					payload.turnId,
					turn.revision,
					callId,
					result,
					parts,
					output,
				),
			),
		);
		return null;
	});
	const finish = Effect.fn("AssistantTurnRuntime.finish")(function* (
		payload: AssistantTurnPayload,
		error: null | AssistantTurnFailure,
	) {
		const state = yield* load(payload);
		if (terminalStatuses.has(state.turn.status)) {
			return true;
		}
		if (error === null) {
			const outcome = yield* latest(payload, (turn) =>
				write(
					payload.userId,
					repository.complete(payload.userId, turn.conversationId, payload.turnId, turn.revision),
				),
			);
			return outcome.completed;
		}
		for (const step of [
			(turn: { readonly revision: number; readonly conversationId: string }) =>
				repository.deliverInbox(payload.userId, turn.conversationId, payload.turnId, turn.revision),
			(turn: { readonly revision: number; readonly conversationId: string }) =>
				repository.transition(
					payload.userId,
					turn.conversationId,
					payload.turnId,
					turn.revision,
					"failed",
					error,
				),
		]) {
			yield* latest(payload, (turn) => write(payload.userId, step(turn)));
		}
		return true;
	});
	return { finish, generate, decision, dispatch, isActive, recordRound };
});

export class AssistantTurnRuntime extends Context.Service<AssistantTurnRuntime>()(
	"@ryot-app/kernel-backend/modules/assistant/turn-runtime/AssistantTurnRuntime",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			return yield* makeAssistantTurnRuntime({
				model: yield* AssistantModel,
				tools: yield* AgentToolsService,
				providers: yield* AssistantProviderConfiguration,
				checkAccount: (userId) => auth.resolveTrustedAccount(userId).pipe(Effect.asVoid),
			});
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
