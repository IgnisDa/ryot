import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import {
	type AssistantMessage,
	AssistantReasoningField,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { AgentToolDescriptor } from "@ryot-app/contract/schema/agent-tool";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import {
	Cause,
	Context,
	Duration,
	Effect,
	Layer,
	Option,
	References,
	Schema,
	Stream,
} from "effect";
import { AiError, Prompt, Tool, Toolkit } from "effect/ai";
import { HttpClient } from "effect/http";

import { EgressHttpClientLive } from "#platform/egress/http-client";

import { retainedPreview } from "./local-tools";
import type { AssistantProvider } from "./provider-configuration";

export class AssistantModelError extends Schema.TaggedError<
	AssistantModelError,
	{ readonly brand: unique symbol }
>()("AssistantModelError", { code: Schema.Literals(["provider-failed", "context-overflow"]) }) {}
export const AssistantModelEvent = Schema.Union([
	Schema.Struct({ text: Schema.String, type: Schema.Literal("text-delta") }),
	Schema.Struct({
		text: Schema.String,
		field: AssistantReasoningField,
		type: Schema.Literal("reasoning-delta"),
	}),
	Schema.Struct({
		arguments: JsonValue,
		name: Schema.NonEmptyString,
		type: Schema.Literal("tool-call"),
		modelCallId: Schema.NonEmptyString,
	}),
	Schema.Struct({
		reason: Schema.String,
		type: Schema.Literal("finish"),
		inputTokens: Schema.optional(Schema.Int),
	}),
]);
export type AssistantModelEvent = typeof AssistantModelEvent.Type;
export type AssistantModelTool = { readonly name: string } & Pick<
	AgentToolDescriptor,
	"input" | "description"
>;
export type AssistantModelRequest = {
	readonly prompt: Prompt.Prompt;
	readonly maxOutputTokens: number;
	readonly provider: AssistantProvider;
	readonly tools: readonly AssistantModelTool[];
};
const IDLE_TIMEOUT = "2 minutes";
const RETRIES = 4;
const overflowPattern =
	/context[ _-]?length|context window|maximum context|too many tokens|prompt is too long|input is too long/i;

class AssistantModelIdle extends Schema.TaggedError<
	AssistantModelIdle,
	{ readonly brand: unique symbol }
>()("AssistantModelIdle", {}) {}

const providerFailureDetails = (cause: Cause.Cause<unknown>) => {
	const error = Cause.findErrorOption(cause);
	if (Option.isNone(error)) {
		return { error: Cause.pretty(cause) };
	}
	if (!AiError.isAiError(error.value)) {
		return { error: String(error.value) };
	}
	const reason = error.value.reason;
	const http = "http" in reason ? reason.http : undefined;
	return {
		reason: reason._tag,
		error: error.value.message,
		status: http?.response?.status,
		body: http?.body === undefined ? undefined : http.body.slice(0, 2_000),
	};
};

const classify = (cause: Cause.Cause<unknown>) => {
	const error = Cause.findErrorOption(cause);
	if (Option.isSome(error) && error.value instanceof AssistantModelIdle) {
		return { retryable: true, overflow: false, retryAfter: undefined };
	}
	if (Option.isNone(error) || !AiError.isAiError(error.value)) {
		return { overflow: false, retryable: false, retryAfter: undefined };
	}
	const reason = error.value.reason;
	const body = "http" in reason ? (reason.http?.body ?? "") : "";
	return {
		retryable: reason.isRetryable,
		retryAfter: "retryAfter" in reason ? reason.retryAfter : undefined,
		overflow:
			reason._tag === "InvalidRequestError" &&
			overflowPattern.test(`${error.value.message} ${body}`),
	};
};

const failed = (request: AssistantModelRequest, cause: Cause.Cause<unknown>) =>
	Effect.logWarning("Assistant provider request failed", providerFailureDetails(cause)).pipe(
		Effect.annotateLogs({
			model: request.provider.model,
			source: request.provider.source,
			provider: request.provider.baseUrl,
		}),
		Effect.andThen(Effect.fail(new AssistantModelError({ code: "provider-failed" }))),
	);
const retryDelay = (attempt: number, retryAfter: undefined | Duration.Duration) =>
	Duration.max(
		retryAfter ?? Duration.zero,
		Duration.millis(Math.min(30_000, 1_000 * 2 ** attempt) * (0.5 + Math.random() / 2)),
	);

export class AssistantModel extends Context.Service<
	AssistantModel,
	{
		readonly stream: (
			request: AssistantModelRequest,
		) => Stream.Stream<AssistantModelEvent, AssistantModelError>;
	}
>()("@ryot-app/kernel-backend/modules/assistant/provider-model/AssistantModel") {
	static readonly make = Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		const attempt = (
			request: AssistantModelRequest,
			retry: number,
		): Stream.Stream<AssistantModelEvent, AssistantModelError> =>
			Stream.unwrap(
				Effect.gen(function* () {
					const client = yield* OpenAiClient.make({
						apiKey: request.provider.apiKey,
						apiUrl: request.provider.baseUrl,
					}).pipe(Effect.provideService(HttpClient.HttpClient, http));
					const model = yield* OpenAiLanguageModel.make({
						model: request.provider.model,
						config: { max_output_tokens: request.maxOutputTokens },
					}).pipe(Effect.provideService(OpenAiClient.OpenAiClient, client));
					const toolkit = Toolkit.make(
						...request.tools.map((tool) =>
							Tool.dynamic(tool.name, { parameters: tool.input, description: tool.description }),
						),
					);
					let emitted = false;
					let reasoningField: AssistantReasoningField = "reasoning_content";
					return model
						.streamText({
							toolkit,
							prompt: request.prompt,
							toolCallValidation: "deferred",
							disableToolCallResolution: true,
						})
						.pipe(
							Stream.provideService(References.TracerEnabled, false),
							Stream.timeoutOrElse({
								duration: IDLE_TIMEOUT,
								orElse: () => Stream.fail(new AssistantModelIdle()),
							}),
							Stream.mapEffect(
								Effect.fn(function* (part) {
									if (part.type === "text-delta") {
										emitted = true;
										return { text: part.delta, type: "text-delta" } satisfies AssistantModelEvent;
									}
									if (part.type === "reasoning-start") {
										reasoningField =
											part.metadata["openai-compat"]?.reasoningField ?? reasoningField;
									}
									if (part.type === "reasoning-delta") {
										emitted = true;
										return {
											text: part.delta,
											field: reasoningField,
											type: "reasoning-delta",
										} satisfies AssistantModelEvent;
									}
									if (part.type === "tool-call") {
										emitted = true;
										if (part.providerExecuted) {
											return yield* new AssistantModelError({ code: "provider-failed" });
										}
										const args = yield* Schema.decodeUnknownEffect(JsonValue)(part.params).pipe(
											Effect.mapError(() => new AssistantModelError({ code: "provider-failed" })),
										);
										return {
											name: part.name,
											arguments: args,
											type: "tool-call",
											modelCallId: part.id,
										} satisfies AssistantModelEvent;
									}
									if (part.type === "finish") {
										return {
											type: "finish",
											reason: part.reason,
											...(part.usage.inputTokens.total === undefined
												? {}
												: { inputTokens: part.usage.inputTokens.total }),
										} satisfies AssistantModelEvent;
									}
									return null;
								}),
							),
							Stream.filter((event) => event !== null),
							Stream.catchCause((cause) => {
								if (Cause.hasInterrupts(cause)) {
									return Stream.failCause(Cause.interrupt());
								}
								const error = Cause.findErrorOption(cause);
								if (Option.isSome(error) && error.value instanceof AssistantModelError) {
									return Stream.fail(error.value);
								}
								const failure = classify(cause);
								if (!emitted && failure.overflow) {
									return Stream.fail(new AssistantModelError({ code: "context-overflow" }));
								}
								if (!emitted && failure.retryable && retry < RETRIES) {
									return Stream.unwrap(
										Effect.sleep(retryDelay(retry, failure.retryAfter)).pipe(
											Effect.as(attempt(request, retry + 1)),
										),
									);
								}
								return Stream.fromEffect(failed(request, cause));
							}),
						);
				}),
			);
		return { stream: (request: AssistantModelRequest) => attempt(request, 0) };
	});
	static readonly layer = Layer.effect(this, this.make);
	static readonly live = this.layer.pipe(Layer.provide(EgressHttpClientLive));
}

const modelVisibleResult = (result: AgentToolResult) => {
	if (result.truncated === false) {
		return result.value;
	}
	return result.truncated === true
		? `${result.jsonPrefix}\n[Output truncated at its producer's limit]`
		: retainedPreview(result);
};

export const assistantProviderPrompt = (
	system: string,
	summary: null | string,
	messages: readonly Pick<AssistantMessage, "role" | "parts">[],
): Prompt.Prompt => {
	const calls = new Map(
		messages.flatMap((message) =>
			message.parts.flatMap((part) =>
				part.kind === "tool-call" && part.call.kind === "tool"
					? [[part.call.id, part.call] as const]
					: [],
			),
		),
	);
	const history: Prompt.Message[] = [Prompt.makeMessage("system", { content: system })];
	if (summary !== null) {
		history.push(
			Prompt.makeMessage("user", {
				content: [
					Prompt.makePart("text", {
						text: `<conversation-summary>\n${summary}\n</conversation-summary>\nThis summarizes the earlier part of this conversation, which is no longer shown.`,
					}),
				],
			}),
		);
	}
	for (const message of messages) {
		if (message.role === "user") {
			const content = message.parts.flatMap((part) =>
				part.kind === "text" || part.kind === "instruction"
					? [Prompt.makePart("text", { text: part.text })]
					: [],
			);
			if (content.length > 0) {
				history.push(Prompt.makeMessage("user", { content }));
			}
		} else if (message.role === "assistant") {
			const content = message.parts.flatMap(
				(part): (Prompt.TextPart | Prompt.ToolCallPart | Prompt.ReasoningPart)[] => {
					if (part.kind === "text") {
						return [Prompt.makePart("text", { text: part.text })];
					}
					if (part.kind === "reasoning") {
						return [
							Prompt.makePart("reasoning", {
								text: part.text,
								options: { "openai-compat": { reasoningField: part.field } },
							}),
						];
					}
					if (part.kind === "tool-call" && part.call.kind === "tool") {
						return [
							Prompt.makePart("tool-call", {
								name: part.call.tool,
								providerExecuted: false,
								id: part.call.modelCallId,
								params: part.call.arguments,
							}),
						];
					}
					return [];
				},
			);
			const previous = history.at(-1);
			if (previous?.role === "assistant") {
				history[history.length - 1] = Prompt.makeMessage("assistant", {
					content: [...previous.content, ...content],
				});
			} else if (content.length > 0) {
				history.push(Prompt.makeMessage("assistant", { content }));
			}
		} else {
			const content = message.parts.flatMap((part) => {
				if (part.kind !== "tool-result") {
					return [];
				}
				const call = calls.get(part.toolCallId);
				if (!call) {
					throw new Error("Assistant tool result is missing its persisted call");
				}
				return [
					Prompt.makePart("tool-result", {
						name: call.tool,
						isFailure: false,
						id: call.modelCallId,
						providerExecuted: false,
						result: modelVisibleResult(part.result),
					}),
				];
			});
			if (content.length > 0) {
				history.push(Prompt.makeMessage("tool", { content }));
			}
		}
	}
	return Prompt.make(history);
};
