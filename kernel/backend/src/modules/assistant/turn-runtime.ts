import {
	AssistantError,
	type AssistantMessage,
	type AssistantMessagePart,
	AssistantToolCall,
	type AssistantTurnFailure,
} from "@ryot-app/contract/modules/assistant/schemas";
import { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import { AssistantToolCallId, type UserId } from "@ryot-app/contract/schema/brands";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Option, Schema, Stream } from "effect";

import { AuthService } from "#modules/accounts/auth/service";
import { agentToolDescriptorPin, AgentToolsService } from "#modules/agent-tools/service";
import { publishAssistantUpdated } from "#modules/live-updates/publish";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { DatabaseSession } from "#platform/db/session";
import { defaultResultByteBudget, truncateJsonResult } from "#platform/tool-result";

import { assistantContext, assistantContextByteBudget } from "./context";
import { AssistantProviderConfiguration } from "./provider-configuration";
import {
	AssistantModel,
	assistantModelRequestByteBudget,
	assistantProviderPrompt,
} from "./provider-model";
import { AssistantRepository } from "./repository";
import { loadAssistantSdkReference } from "./sdk-reference";

export const AssistantRound = Schema.Struct({ calls: Schema.Array(AssistantToolCall) });
export type AssistantRound = typeof AssistantRound.Type;
export type AssistantTurnPayload = { readonly userId: UserId; readonly turnId: string };

const failure = (code: AssistantTurnFailure["code"]): AssistantTurnFailure => ({ code });
const toolFailure = (): AgentToolResult =>
	truncateJsonResult({
		error: "tool-failed",
		instruction:
			"The call was refused or failed. Discover the current tool and ask for approval again if needed.",
	});

export const makeAssistantTurnRuntime = Effect.fn(function* ({
	sdk,
	tools,
	model,
	providers,
	checkAccount,
}: {
	readonly sdk: string;
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
	) {
		let state = yield* load(payload);
		if (state.turn.round >= round) {
			return { calls: state.calls.filter((call) => call.round === round).map((call) => call.call) };
		}
		if (["failed", "completed", "interrupted"].includes(state.turn.status)) {
			return { calls: [] };
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
		const available = yield* tools.listTrusted(payload.userId);
		const system = `You are an assistant. Use tools to inspect current data. All persisted writes, including page authoring, require user approval. Repair page compiler diagnostics with bounded changes, compile again, and show the successful preview. Saving publishes a page and creates a saved view; sharing uses the publication UI. Never claim a declined or failed call succeeded.\n\n${sdk}`;
		const promptFor = (messages: readonly Pick<AssistantMessage, "role" | "parts">[]) =>
			assistantProviderPrompt(
				system,
				messages.filter(
					(message) =>
						message.role !== "user" || message.parts.some((part) => part.kind === "text"),
				),
			);
		const history = assistantContext(
			state.messages.filter((message) => message.id !== `${payload.turnId}:round:${round}:text`),
			assistantContextByteBudget,
			(messages) =>
				new TextEncoder().encode(stableStringify([promptFor(messages), available])).byteLength <=
				assistantModelRequestByteBudget,
		);
		if (history.length === 0) {
			return yield* Effect.fail(failure("provider-failed"));
		}
		const prompt = promptFor(history);

		let text = "";
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
					} else if (event.type === "tool-call") {
						if (
							calls.some((candidate) => candidate.modelCallId === event.modelCallId) ||
							calls.length >= 32
						) {
							return yield* Effect.fail(failure("provider-failed"));
						}
						const validated = yield* tools.validateTrusted(payload.userId, {
							name: event.name,
							arguments: event.arguments,
						});
						calls.push({
							arguments: event.arguments,
							descriptor: validated.tool,
							modelCallId: event.modelCallId,
							requiresApproval: validated.requiresApproval,
							id: AssistantToolCallId.make(`${payload.turnId}:${round}:${calls.length}`),
						});
					} else {
						finishReasons.push(event.reason);
					}
					return undefined;
				}),
			),
			Effect.mapError(() => failure("provider-failed")),
		);
		if (!finishReasons.some((reason) => reason === "stop" || reason === "tool-calls")) {
			return yield* Effect.fail(failure("provider-failed"));
		}
		yield* persistText();
		return { calls };
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
				{ text: "", calls: result.calls },
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
	const dispatch = Effect.fn("AssistantTurnRuntime.dispatch")(function* (
		payload: AssistantTurnPayload,
		callId: string,
	) {
		const state = yield* load(payload);
		const stored = state.calls.find((candidate) => candidate.id === callId);
		if (!stored) {
			return yield* new AssistantError({ reason: { code: "tool-call-not-found" } });
		}
		if (
			stored.result !== null ||
			!["queued", "running", "awaiting-approval"].includes(state.turn.status)
		) {
			return undefined;
		}
		const call = stored.call;
		if (call.requiresApproval && stored.decision === null) {
			return yield* new AssistantError({ reason: { code: "turn-not-active" } });
		}
		let result: AgentToolResult;
		if (stored.decision === "decline") {
			result = truncateJsonResult({ declined: true });
		} else {
			const input = {
				arguments: call.arguments,
				name: call.descriptor.name,
				byteBudget: defaultResultByteBudget,
				descriptorPin: agentToolDescriptorPin(call.descriptor),
				idempotencyKey: `assistant:${payload.turnId}:${call.id}`,
			};
			result = yield* Effect.gen(function* () {
				const validated = yield* tools.validateTrusted(payload.userId, input);
				if (validated.requiresApproval !== call.requiresApproval) {
					return toolFailure();
				}
				return yield* tools.callTrusted(payload.userId, input);
			}).pipe(
				Effect.catch((error) => {
					if (error._tag === "PageAuthoringError" && error.reason.code === "build-failed") {
						return Effect.succeed(
							truncateJsonResult({
								error: "build-failed",
								diagnostics: error.reason.diagnostics,
								instruction: "Repair these compiler diagnostics and compile the same page again.",
							}),
						);
					}
					return Effect.succeed(toolFailure());
				}),
			);
		}
		const parts: AssistantMessagePart[] = [];
		if (call.descriptor.name === "page_compile" && !result.truncated) {
			const preview = Schema.decodeUnknownOption(PageDraftBuildIdentity)(result.value);
			if (Option.isSome(preview)) {
				parts.push({ kind: "page-preview", ...preview.value });
			}
		}
		yield* Effect.gen(function* () {
			const latest = yield* load(payload);
			yield* write(
				payload.userId,
				repository.recordResult(
					payload.userId,
					latest.turn.conversationId,
					payload.turnId,
					latest.turn.revision,
					callId,
					result,
					parts,
				),
			);
		}).pipe(
			Effect.retry({
				times: 32,
				while: (error) => error instanceof AssistantError && error.reason.code === "revision-stale",
			}),
		);
		return undefined;
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
				sdk: yield* loadAssistantSdkReference,
				providers: yield* AssistantProviderConfiguration,
				checkAccount: (userId) => auth.resolveTrustedAccount(userId).pipe(Effect.asVoid),
			});
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
