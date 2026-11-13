import {
	AssistantError,
	type AssistantMessage,
	type AssistantMessagePart,
	AssistantReasoningField,
	AssistantToolCall,
	type AssistantTurnFailure,
} from "@ryot-app/contract/modules/assistant/schemas";
import { AgentToolName } from "@ryot-app/contract/schema/agent-tool";
import { AssistantToolCallId, type UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema, Stream } from "effect";

import { AuthService } from "#modules/accounts/auth/service";
import { capabilityPin } from "#modules/agent-tools/catalog";
import type { WriteGate, WriteRequest } from "#modules/agent-tools/execute";
import { AgentToolsService } from "#modules/agent-tools/service";
import { publishAssistantUpdated } from "#modules/live-updates/publish";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { AgentRunSuspended } from "#modules/scripts/agent/service";
import { DatabaseSession } from "#platform/db/session";
import { defaultResultByteBudget, truncateJsonResult } from "#platform/tool-result";

import { assistantContext, assistantContextByteBudget, assistantTurnHistory } from "./context";
import { AssistantProviderConfiguration } from "./provider-configuration";
import {
	AssistantModel,
	assistantModelRequestByteBudget,
	assistantProviderPrompt,
} from "./provider-model";
import { AssistantRepository } from "./repository";

export const AssistantRound = Schema.Struct({
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
const assistantSystemPrompt =
	"You are Ryo, the assistant inside Ryot. Inspect current data with tools instead of guessing. Find capabilities with search, then run them with execute; combine related calls in one execute and return only the fields you need. Answer as soon as you have what the request needs instead of searching further. Every write through execute and every page publication requires user approval; page drafts do not, because they stay private until the user saves them. Never claim a declined or failed call succeeded. Before building a page, read the pages documentation with read_docs. Write pages with page_write, repair compiler diagnostics with bounded changes and write again until the preview succeeds. The user saves a previewed draft, which publishes it and creates a saved view; sharing uses the publication UI. Call read_docs without a topic to list documentation.";

const finalRoundPrompt =
	" You have used every tool round for this request, so no tools are available now. Answer from what you found, and say plainly what you could not find or finish.";

const promptFor = (messages: readonly Pick<AssistantMessage, "role" | "parts">[], final: boolean) =>
	assistantProviderPrompt(
		final ? assistantSystemPrompt + finalRoundPrompt : assistantSystemPrompt,
		messages.filter(
			(message) => message.role !== "user" || message.parts.some((part) => part.kind === "text"),
		),
	);

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
	const generate = Effect.fn("AssistantTurnRuntime.generate")(function* (
		payload: AssistantTurnPayload,
		round: number,
		final: boolean,
	) {
		let state = yield* load(payload);
		if (state.turn.round >= round) {
			return {
				reasoning: null,
				calls: state.calls.filter((call) => call.round === round).map((call) => call.call),
			};
		}
		if (["failed", "completed", "interrupted"].includes(state.turn.status)) {
			return { calls: [], reasoning: null };
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
			state = yield* load(payload);
		}
		const provider = yield* providers
			.effective(payload.userId)
			.pipe(Effect.mapError(() => failure("provider-unavailable")));
		if (!provider) {
			return yield* Effect.fail(failure("provider-unavailable"));
		}
		const available = final ? [] : yield* tools.listTrusted(payload.userId);
		const history = assistantContext(
			assistantTurnHistory(
				state.messages.filter((message) => message.id !== `${payload.turnId}:round:${round}:text`),
				payload.turnId,
			),
			assistantContextByteBudget,
			(messages) =>
				new TextEncoder().encode(stableStringify([promptFor(messages, final), available]))
					.byteLength <= assistantModelRequestByteBudget,
			(message) => message.turnId === payload.turnId && message.role === "user",
		);
		if (history.length === 0) {
			yield* Effect.logWarning("Assistant history did not fit the model request budget");
			return yield* Effect.fail(failure("provider-failed"));
		}
		const prompt = promptFor(history, final);

		let text = "";
		let reasoning: AssistantRound["reasoning"] = null;
		let persistedLength = -1;
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
		yield* model.stream({ prompt, provider, tools: available }).pipe(
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
							) ||
							calls.length >= 32
						) {
							return yield* Effect.fail(failure("provider-failed"));
						}
						if (!Schema.is(AgentToolName)(event.name)) {
							yield* Effect.logWarning("Assistant model called an unknown tool", {
								tool: event.name,
							});
							return yield* Effect.fail(failure("provider-failed"));
						}
						const requiresApproval = yield* tools
							.validateTrusted(payload.userId, { name: event.name, arguments: event.arguments })
							.pipe(
								Effect.map((validated) => validated.requiresApproval),
								Effect.catchTag(["BadRequest", "DemoOperationProtected"], () =>
									Effect.succeed(false),
								),
							);
						calls.push({
							kind: "tool",
							requiresApproval,
							tool: event.name,
							arguments: event.arguments,
							modelCallId: event.modelCallId,
							id: AssistantToolCallId.make(`${payload.turnId}:${round}:${calls.length}`),
						});
					} else {
						finishReasons.push(event.reason);
					}
					return undefined;
				}),
			),
			Effect.tapError((error) =>
				Effect.logWarning("Assistant model request failed", {
					error: "code" in error ? error.code : String(error),
				}),
			),
			Effect.mapError(() => failure("provider-failed")),
		);
		if (!finishReasons.some((reason) => reason === "stop" || reason === "tool-calls")) {
			yield* Effect.logWarning("Assistant model stream ended without a usable finish reason", {
				finishReasons,
			});
			return yield* Effect.fail(failure("provider-failed"));
		}
		if (final && calls.length > 0) {
			return yield* Effect.fail(failure("round-limit"));
		}
		yield* persistText();
		return { calls, reasoning };
	});
	const recordRound = Effect.fn("AssistantTurnRuntime.recordRound")(function* (
		payload: AssistantTurnPayload,
		round: number,
		result: AssistantRound,
	) {
		const state = yield* load(payload);
		if (
			state.turn.round >= round ||
			["failed", "completed", "interrupted"].includes(state.turn.status)
		) {
			return;
		}
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
	});
	const isActive = Effect.fn(function* (payload: AssistantTurnPayload) {
		const state = yield* load(payload);
		return ["queued", "running", "awaiting-approval"].includes(state.turn.status);
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
		return ["failed", "completed", "interrupted"].includes(state.turn.status)
			? "decline"
			: call.decision;
	});
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
			!["queued", "running", "awaiting-approval"].includes(state.turn.status)
		) {
			return null;
		}
		if (call.requiresApproval && stored.decision === null) {
			return yield* new AssistantError({ reason: { code: "turn-not-active" } });
		}
		const parts: AssistantMessagePart[] = [];
		let result: AgentToolResult;
		if (stored.decision === "decline") {
			result = truncateJsonResult({ declined: true });
		} else {
			const input = {
				name: call.tool,
				arguments: call.arguments,
				confirm: gate(payload, call.id),
				byteBudget: defaultResultByteBudget,
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
			result = outcome.result;
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
		if (["failed", "completed", "interrupted"].includes(state.turn.status)) {
			return;
		}
		yield* write(
			payload.userId,
			repository.transition(
				payload.userId,
				state.turn.conversationId,
				payload.turnId,
				state.turn.revision,
				error === null ? "completed" : "failed",
				error,
			),
		);
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
