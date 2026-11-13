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
	provider: {
		source: "user",
		model: "local",
		apiKey: undefined,
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
			expect(stableStringify(bodies)).toContain("32768");
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
				new Response('{"error":{"message":"secret-provider-diagnostic"}}', { status: 500 }),
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
					Effect.succeed(HttpClientResponse.fromWeb(incoming, reply)),
				);
				const exit = yield* Effect.exit(collect(client, request));
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
						new Response('{"error":{"message":"secret-provider-diagnostic"}}', { status: 500 }),
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

it.effect("rejects oversized prompts before making a request", () =>
	Effect.gen(function* () {
		let transports = 0;
		const client = HttpClient.make((incoming) =>
			Effect.sync(() => {
				transports += 1;
				return HttpClientResponse.fromWeb(incoming, response());
			}),
		);
		const exit = yield* Effect.exit(
			collect(client, { ...request, prompt: Prompt.make("x".repeat(1_048_577)) }),
		);
		assertExitFails(exit, new AssistantModelError({ code: "request-limit" }));
		expect(transports).toBe(0);
	}),
);

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

it.effect("bounds streamed content rather than per-chunk framing", () =>
	Effect.gen(function* () {
		const events = yield* collect(streamedToolArguments(20_000, "page"), request);
		expect(events.filter((event) => event.type === "tool-call")).toEqual([
			{
				name: "search",
				type: "tool-call",
				modelCallId: "model-call-1",
				arguments: { query: "page".repeat(20_000) },
			},
		]);
		assertExitFails(
			yield* Effect.exit(collect(streamedToolArguments(257, "x".repeat(1_024)), request)),
			new AssistantModelError({ code: "output-limit" }),
		);
	}),
);

it.effect("bounds streamed output and cancels a stalled provider request", () =>
	Effect.gen(function* () {
		const oversized = HttpClient.make((incoming) =>
			Effect.succeed(
				HttpClientResponse.fromWeb(
					incoming,
					new Response(sse({ content: "x".repeat(262_145) }), {
						headers: { "content-type": "text/event-stream" },
					}),
				),
			),
		);
		assertExitFails(
			yield* Effect.exit(collect(oversized, request)),
			new AssistantModelError({ code: "output-limit" }),
		);
		const stalled = HttpClient.make(() => Effect.never);
		const fiber = yield* collect(stalled, request).pipe(Effect.forkChild);
		yield* TestClock.adjust("2 minutes");
		assertExitFails(
			yield* Fiber.await(fiber),
			new AssistantModelError({ code: "provider-failed" }),
		);
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
			prompt: assistantProviderPrompt("system", [
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
