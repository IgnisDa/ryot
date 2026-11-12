import { expect } from "bun:test";

import type { AgentToolDescriptor } from "@ryot-app/contract/schema/agent-tool";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Fiber, Stream } from "effect";
import { Prompt } from "effect/ai";
import { HttpClient, HttpClientResponse } from "effect/http";
import { IpNetwork } from "effect/net";
import { TestClock } from "effect/testing";

import { withEgressPolicy } from "#platform/egress/http-client";

import { AssistantModel, AssistantModelError, type AssistantModelRequest } from "./provider-model";

const tool: AgentToolDescriptor = {
	output: {},
	name: "lookup",
	description: "Read records",
	source: { kind: "describe-data" },
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
						function: { name: "lookup", arguments: '{"query":' },
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
			expect(stableStringify(bodies)).toContain("8192");
			expect(
				events
					.filter((event) => event.type === "text-delta")
					.map((event) => event.text)
					.join(""),
			).toBe("Found records");
			expect(events.filter((event) => event.type === "tool-call")).toEqual([
				{
					name: "lookup",
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
								function: { name: "lookup", arguments: "invalid-json" },
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
