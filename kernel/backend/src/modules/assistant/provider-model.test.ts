import { expect } from "bun:test";

import type { AgentToolDescriptor } from "@ryot-app/contract/schema/agent-tool";
import { AssistantToolCallId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { it, layer } from "@voila.dev/effect-bun-test";
import { Effect, Fiber, Logger, Schema, Stream } from "effect";
import { Prompt } from "effect/ai";
import { HttpClient, HttpClientResponse } from "effect/http";
import { IpNetwork } from "effect/net";
import { TestClock } from "effect/testing";

import { withEgressPolicy } from "#platform/egress/http-client";

import {
	AssistantModel,
	AssistantModelError,
	type AssistantModelRequest,
	assistantProviderPrompt,
} from "./provider-model";

const tool: AgentToolDescriptor = {
	name: "search",
	title: "Search",
	approval: "none",
	description: "Read records",
	hints: { readOnly: true, idempotent: true, destructive: false },
	input: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
};
const prompt = Prompt.make([
	Prompt.makeMessage("user", { content: [Prompt.makePart("text", { text: "Read records" })] }),
]);
const request = {
	prompt,
	tools: [tool],
	maxOutputTokens: 4_096,
	provider: {
		source: "user",
		model: "local",
		apiKey: undefined,
		contextWindow: 64_000,
		maxOutputTokens: 4_096,
		baseUrl: "http://127.0.0.1:11434/v1",
	},
} as const;
const sse = (delta: unknown, finish_reason: null | string = null) =>
	`data: ${stableStringify({ created: 1, id: "response", model: "local", object: "chat.completion.chunk", choices: [{ delta, index: 0, finish_reason }] })}\n\n`;
const ChatRequest = Schema.fromJsonString(
	Schema.Struct({ messages: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
);
const collect = Effect.fn(function* (client: HttpClient.HttpClient, input: AssistantModelRequest) {
	const model = yield* AssistantModel.make.pipe(
		Effect.provideService(HttpClient.HttpClient, client),
	);
	return yield* Stream.runCollect(model.stream(input));
});
const response = () =>
	new Response(
		[
			sse({ content: "Found " }),
			sse({ content: "records" }),
			sse({
				tool_calls: [
					{
						index: 0,
						type: "function",
						id: "model-call-1",
						function: { name: "search", arguments: '{"query":' },
					},
				],
			}),
			sse({ tool_calls: [{ index: 0, function: { arguments: '"recent"}' } }] }),
			sse({}, "tool_calls"),
			"data: [DONE]\n\n",
		].join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);

it.effect(
	"uses Chat Completions without authentication and assembles fragmented tool arguments without dispatch",
	() =>
		Effect.gen(function* () {
			const requests: string[] = [];
			const bodies: unknown[] = [];
			const client = HttpClient.make((incoming) =>
				Effect.sync(() => {
					requests.push(`${incoming.method} ${incoming.url}`);
					expect(incoming.headers["authorization"]).toBeUndefined();
					bodies.push(incoming.body);
					return HttpClientResponse.fromWeb(incoming, response());
				}),
			);
			const events = yield* collect(client, request);
			expect(requests).toEqual(["POST http://127.0.0.1:11434/v1/chat/completions"]);
			expect(stableStringify(bodies)).toContain("max_tokens");
			expect(stableStringify(bodies)).toContain("4096");
			expect(
				events
					.filter((event) => event.type === "text-delta")
					.map((event) => event.text)
					.join(""),
			).toBe("Found records");
			expect(events.filter((event) => event.type === "tool-call")).toEqual([
				{
					name: "search",
					type: "tool-call",
					modelCallId: "model-call-1",
					arguments: { query: "recent" },
				},
			]);
		}),
);

it.effect(
	"enforces the shared egress policy before transport and allows an explicitly permitted local network",
	() =>
		Effect.gen(function* () {
			let transports = 0;
			const client = HttpClient.make((incoming) =>
				Effect.sync(() => {
					transports += 1;
					return HttpClientResponse.fromWeb(incoming, response());
				}),
			);
			for (const allow of [false, true]) {
				const protectedClient = withEgressPolicy(client, {
					resolver: { resolve: () => Effect.succeed(["127.0.0.1"]) },
					allowedNetworks: allow ? [IpNetwork.fromStringUnsafe("127.0.0.0/8")] : [],
				});
				const exit = yield* Effect.exit(collect(protectedClient, request));
				if (allow) {
					expect(transports).toBe(1);
				} else {
					assertExitFails(exit, new AssistantModelError({ code: "provider-failed" }));
					expect(transports).toBe(0);
				}
			}
		}),
);

it.effect(
	"returns a bounded safe error for provider diagnostics and malformed streamed arguments",
	() =>
		Effect.gen(function* () {
			for (const reply of [
				() => new Response('{"error":{"message":"secret-provider-diagnostic"}}', { status: 400 }),
				() =>
					new Response(
						sse({
							tool_calls: [
								{
									index: 0,
									id: "bad",
									type: "function",
									function: { name: "search", arguments: "invalid-json" },
								},
							],
						}) +
							sse({}, "tool_calls") +
							"data: [DONE]\n\n",
						{ headers: { "content-type": "text/event-stream" } },
					),
			]) {
				const client = HttpClient.make((incoming) =>
					Effect.sync(() => HttpClientResponse.fromWeb(incoming, reply())),
				);
				const fiber = yield* collect(client, request).pipe(Effect.forkChild);
				yield* TestClock.adjust("1 hour");
				const exit = yield* Fiber.await(fiber);
				assertExitFails(exit, new AssistantModelError({ code: "provider-failed" }));
				expect(stableStringify(exit)).not.toContain("secret-provider-diagnostic");
			}
		}),
);

const providerLogMessages: unknown[] = [];
const providerLogLayer = Logger.layer([
	Logger.make<unknown, void>((options) => {
		providerLogMessages.push(options.message);
	}),
]);

layer(providerLogLayer)((test) => {
	test.effect("logs provider diagnostics without exposing them in the failure", () =>
		Effect.gen(function* () {
			const client = HttpClient.make((incoming) =>
				Effect.succeed(
					HttpClientResponse.fromWeb(
						incoming,
						new Response('{"error":{"message":"secret-provider-diagnostic"}}', { status: 400 }),
					),
				),
			);
			const exit = yield* Effect.exit(collect(client, request));
			assertExitFails(exit, new AssistantModelError({ code: "provider-failed" }));
			expect(stableStringify(providerLogMessages)).toContain("secret-provider-diagnostic");
			expect(stableStringify(exit)).not.toContain("secret-provider-diagnostic");
		}),
	);
});

const streamedToolArguments = (chunks: number, text: string) =>
	HttpClient.make((incoming) =>
		Effect.succeed(
			HttpClientResponse.fromWeb(
				incoming,
				new Response(
					[
						sse({
							tool_calls: [
								{
									index: 0,
									type: "function",
									id: "model-call-1",
									function: { name: "search", arguments: '{"query":"' },
								},
							],
						}),
						...Array.from({ length: chunks }, () =>
							sse({ tool_calls: [{ index: 0, function: { arguments: text } }] }),
						),
						sse({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }),
						sse({}, "tool_calls"),
						"data: [DONE]\n\n",
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			),
		),
	);

it.effect("streams tool arguments of any size without a byte cap", () =>
	Effect.gen(function* () {
		const events = yield* collect(streamedToolArguments(20_000, "x".repeat(32)), request);
		expect(events.filter((event) => event.type === "tool-call")).toEqual([
			{
				name: "search",
				type: "tool-call",
				modelCallId: "model-call-1",
				arguments: { query: "x".repeat(640_000) },
			},
		]);
	}),
);

const failing = (status: number, body: string) =>
	new Response(`{"error":{"message":"${body}"}}`, { status });

it.effect("retries transient failures before output and reports the prompt's measured size", () =>
	Effect.gen(function* () {
		let transports = 0;
		const client = HttpClient.make((incoming) =>
			Effect.sync(() => {
				transports += 1;
				return HttpClientResponse.fromWeb(
					incoming,
					transports < 3
						? failing(503, "overloaded")
						: new Response(
								sse({ content: "done" }) +
									sse({}, "stop") +
									`data: ${stableStringify({ created: 1, choices: [], id: "response", model: "local", object: "chat.completion.chunk", usage: { total_tokens: 1_235, prompt_tokens: 1_234, completion_tokens: 1 } })}\n\n` +
									"data: [DONE]\n\n",
								{ headers: { "content-type": "text/event-stream" } },
							),
				);
			}),
		);
		const fiber = yield* collect(client, request).pipe(Effect.forkChild);
		yield* TestClock.adjust("2 minutes");
		const events = yield* Fiber.join(fiber);
		expect(transports).toBe(3);
		expect(events.at(-1)).toEqual({ type: "finish", reason: "stop", inputTokens: 1_234 });
	}),
);

it.effect("reports a context overflow without retrying and gives up on persistent failures", () =>
	Effect.gen(function* () {
		let transports = 0;
		const overflow = HttpClient.make((incoming) =>
			Effect.sync(() => {
				transports += 1;
				return HttpClientResponse.fromWeb(
					incoming,
					failing(400, "This model's maximum context length is 65536 tokens"),
				);
			}),
		);
		assertExitFails(
			yield* Effect.exit(collect(overflow, request)),
			new AssistantModelError({ code: "context-overflow" }),
		);
		expect(transports).toBe(1);
		const unavailable = HttpClient.make((incoming) =>
			Effect.succeed(HttpClientResponse.fromWeb(incoming, failing(503, "overloaded"))),
		);
		const stalled = HttpClient.make(() => Effect.never);
		for (const client of [unavailable, stalled]) {
			const fiber = yield* collect(client, request).pipe(Effect.forkChild);
			yield* TestClock.adjust("1 hour");
			assertExitFails(
				yield* Fiber.await(fiber),
				new AssistantModelError({ code: "provider-failed" }),
			);
		}
	}),
);

it.effect("sanitizes transport defects without exposing provider diagnostics", () =>
	Effect.gen(function* () {
		const client = HttpClient.make(() => Effect.die("secret-provider-diagnostic"));
		const exit = yield* Effect.exit(collect(client, request));
		assertExitFails(exit, new AssistantModelError({ code: "provider-failed" }));
		expect(stableStringify(exit)).not.toContain("secret-provider-diagnostic");
	}),
);

it.effect("replays a round as one assistant message with its reasoning, text and tool calls", () =>
	Effect.gen(function* () {
		const bodies: string[] = [];
		const client = HttpClient.make((incoming) =>
			Effect.sync(() => {
				if (incoming.body._tag === "Uint8Array") {
					bodies.push(new TextDecoder().decode(incoming.body.body));
				}
				return HttpClientResponse.fromWeb(
					incoming,
					new Response(
						[
							sse({ reasoning_content: "Need the " }),
							sse({ reasoning_content: "records." }),
							sse({
								tool_calls: [
									{
										index: 0,
										type: "function",
										id: "model-call-1",
										function: { name: "search", arguments: '{"query":"recent"}' },
									},
								],
							}),
							sse({}, "tool_calls"),
							"data: [DONE]\n\n",
						].join(""),
						{ headers: { "content-type": "text/event-stream" } },
					),
				);
			}),
		);
		const events = yield* collect(client, request);
		const reasoning = events.filter((event) => event.type === "reasoning-delta");
		expect(reasoning).toEqual([
			{ text: "Need the ", type: "reasoning-delta", field: "reasoning_content" },
			{ text: "records.", type: "reasoning-delta", field: "reasoning_content" },
		]);
		const call = {
			kind: "tool",
			tool: "search",
			requiresApproval: false,
			modelCallId: "model-call-1",
			arguments: { query: "recent" },
			id: AssistantToolCallId.make("turn:1:0"),
		} as const;
		yield* collect(client, {
			...request,
			prompt: assistantProviderPrompt("system", null, [
				{ role: "user", parts: [{ kind: "text", text: "Read records" }] },
				{ role: "assistant", parts: [{ kind: "text", text: "Checking." }] },
				{
					role: "assistant",
					parts: [
						{ call, kind: "tool-call" },
						{ kind: "reasoning", text: "Need the records.", field: "reasoning_content" },
					],
				},
				{
					role: "tool",
					parts: [
						{ kind: "tool-result", toolCallId: call.id, result: { value: [], truncated: false } },
					],
				},
			]),
		});
		const followUp = yield* Schema.decodeUnknownEffect(ChatRequest)(bodies[1]);
		const assistant = followUp.messages.filter((message) => message["role"] === "assistant");
		expect(assistant).toHaveLength(1);
		expect(assistant[0]).toMatchObject({
			content: "Checking.",
			tool_calls: [{ id: "model-call-1" }],
			reasoning_content: "Need the records.",
		});
	}),
);

it.effect(
	"sends the compaction summary, stored-output previews and instructions as model-visible text",
	() =>
		Effect.gen(function* () {
			const bodies: string[] = [];
			const client = HttpClient.make((incoming) =>
				Effect.sync(() => {
					if (incoming.body._tag === "Uint8Array") {
						bodies.push(new TextDecoder().decode(incoming.body.body));
					}
					return HttpClientResponse.fromWeb(incoming, response());
				}),
			);
			const call = {
				kind: "tool",
				tool: "search",
				requiresApproval: false,
				modelCallId: "model-call-1",
				arguments: { query: "recent" },
				id: AssistantToolCallId.make("turn:1:0"),
			} as const;
			yield* collect(client, {
				...request,
				prompt: assistantProviderPrompt("system", "Earlier work", [
					{ role: "assistant", parts: [{ call, kind: "tool-call" }] },
					{
						role: "tool",
						parts: [
							{
								kind: "tool-result",
								toolCallId: call.id,
								result: {
									lines: 4_000,
									bytes: 90_000,
									outputId: call.id,
									tail: "last line",
									head: "first lines",
									truncated: "retained",
									producerLimited: false,
								},
							},
						],
					},
					{ role: "user", parts: [{ kind: "instruction", text: "Continue where you stopped." }] },
				]),
			});
			const sent = yield* Schema.decodeUnknownEffect(ChatRequest)(bodies[0]);
			expect(sent.messages.map((message) => [message["role"], message["content"]])).toEqual([
				["system", "system"],
				[
					"user",
					"<conversation-summary>\nEarlier work\n</conversation-summary>\nThis summarizes the earlier part of this conversation, which is no longer shown.",
				],
				["assistant", null],
				[
					"tool",
					'first lines\n[Output too large to show in full: 4000 lines, 90000 bytes. Showing the first 1 lines and the end. Read the rest with read_result({ outputId: "turn:1:0", offset }) or search it with a pattern.]\nlast line',
				],
				["user", "Continue where you stopped."],
			]);
		}),
);
