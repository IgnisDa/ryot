import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import type { AssistantMessage } from "@ryot-app/contract/modules/assistant/schemas";
import type { AgentToolDescriptor } from "@ryot-app/contract/schema/agent-tool";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, Context, Effect, Layer, Option, References, Schema, Stream } from "effect";
import { AiError, Prompt, Tool, Toolkit } from "effect/ai";
import { HttpClient } from "effect/http";

import { EgressHttpClientLive } from "#platform/egress/http-client";

import type { AssistantProvider } from "./provider-configuration";

export class AssistantModelError extends Schema.TaggedError<
	AssistantModelError,
	{ readonly brand: unique symbol }
>()("AssistantModelError", {
	code: Schema.Literals(["provider-failed", "request-limit", "output-limit"]),
}) {}
export const AssistantModelEvent = Schema.Union([
	Schema.Struct({ text: Schema.String, type: Schema.Literal("text-delta") }),
	Schema.Struct({
		arguments: JsonValue,
		name: Schema.NonEmptyString,
		type: Schema.Literal("tool-call"),
		modelCallId: Schema.NonEmptyString,
	}),
	Schema.Struct({ reason: Schema.String, type: Schema.Literal("finish") }),
]);
export type AssistantModelEvent = typeof AssistantModelEvent.Type;
export type AssistantModelRequest = {
	readonly prompt: Prompt.Prompt;
	readonly provider: AssistantProvider;
	readonly tools: readonly AgentToolDescriptor[];
};
export const assistantModelRequestByteBudget = 1_048_576;
const limits = {
	events: 16_384,
	maxTokens: 8192,
	outputBytes: 262_144,
	timeout: "2 minutes",
	requestBytes: assistantModelRequestByteBudget,
} as const;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
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
		return {
			stream: (request: AssistantModelRequest) =>
				Stream.unwrap(
					Effect.gen(function* () {
						if (bytes(stableStringify([request.prompt, request.tools])) > limits.requestBytes) {
							return Stream.fail(new AssistantModelError({ code: "request-limit" }));
						}
						const client = yield* OpenAiClient.make({
							apiKey: request.provider.apiKey,
							apiUrl: request.provider.baseUrl,
						}).pipe(Effect.provideService(HttpClient.HttpClient, http));
						const model = yield* OpenAiLanguageModel.make({
							model: request.provider.model,
							config: { max_output_tokens: limits.maxTokens },
						}).pipe(Effect.provideService(OpenAiClient.OpenAiClient, client));
						const toolkit = Toolkit.make(
							...request.tools.map((tool) =>
								Tool.dynamic(tool.name, { parameters: tool.input, description: tool.description }),
							),
						);
						let outputBytes = 0;
						let events = 0;
						return model
							.streamText({
								toolkit,
								prompt: request.prompt,
								toolCallValidation: "deferred",
								disableToolCallResolution: true,
							})
							.pipe(
								Stream.provideService(References.TracerEnabled, false),
								Stream.catchCause((cause) =>
									Cause.hasInterrupts(cause)
										? Stream.failCause(Cause.interrupt())
										: Stream.fromEffect(
												Effect.logWarning(
													"Assistant provider request failed",
													providerFailureDetails(cause),
												).pipe(
													Effect.annotateLogs({
														model: request.provider.model,
														source: request.provider.source,
														provider: request.provider.baseUrl,
													}),
													Effect.andThen(
														Effect.fail(new AssistantModelError({ code: "provider-failed" })),
													),
												),
											),
								),
								Stream.mapEffect(
									Effect.fn(function* (part) {
										events += 1;
										outputBytes += bytes(stableStringify(part));
										if (events > limits.events || outputBytes > limits.outputBytes) {
											return yield* new AssistantModelError({ code: "output-limit" });
										}
										if (part.type === "text-delta") {
											return { text: part.delta, type: "text-delta" } satisfies AssistantModelEvent;
										}
										if (part.type === "tool-call") {
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
											return { type: "finish", reason: part.reason } satisfies AssistantModelEvent;
										}
										return null;
									}),
								),
								Stream.filter((event) => event !== null),
								Stream.interruptWhen(
									Effect.sleep(limits.timeout).pipe(
										Effect.andThen(
											Effect.fail(new AssistantModelError({ code: "provider-failed" })),
										),
									),
								),
								Stream.mapError((error) =>
									error instanceof AssistantModelError
										? error
										: new AssistantModelError({ code: "provider-failed" }),
								),
							);
					}),
				),
		};
	});
	static readonly layer = Layer.effect(this, this.make);
	static readonly live = this.layer.pipe(Layer.provide(EgressHttpClientLive));
}

export const assistantProviderPrompt = (
	system: string,
	messages: readonly Pick<AssistantMessage, "role" | "parts">[],
): Prompt.Prompt => {
	const calls = new Map(
		messages.flatMap((message) =>
			message.parts.flatMap((part) =>
				part.kind === "tool-call" ? [[part.call.id, part.call] as const] : [],
			),
		),
	);
	const history: Prompt.Message[] = [Prompt.makeMessage("system", { content: system })];
	for (const message of messages) {
		if (message.role === "user") {
			history.push(
				Prompt.makeMessage("user", {
					content: message.parts.flatMap((part) =>
						part.kind === "text" ? [Prompt.makePart("text", { text: part.text })] : [],
					),
				}),
			);
		} else if (message.role === "assistant") {
			const content = message.parts.flatMap((part): (Prompt.TextPart | Prompt.ToolCallPart)[] => {
				if (part.kind === "text") {
					return [Prompt.makePart("text", { text: part.text })];
				}
				if (part.kind === "tool-call") {
					return [
						Prompt.makePart("tool-call", {
							providerExecuted: false,
							id: part.call.modelCallId,
							params: part.call.arguments,
							name: part.call.descriptor.name,
						}),
					];
				}
				return [];
			});
			if (content.length > 0) {
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
						isFailure: false,
						result: part.result,
						id: call.modelCallId,
						providerExecuted: false,
						name: call.descriptor.name,
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
