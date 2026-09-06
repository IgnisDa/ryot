import { describe, expect, layer } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, MutableRef, Ref } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { makeRedisService } from "#lib/test-utils/effect";

import { RedisService } from "../redis";
import { ServerRun } from "../server-run";
import { makeRuntimeSandboxApiFunctions } from "./runtime-host-functions";
import type { SandboxRunInput } from "./shared";

const input = {
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	executionId: "execution-1",
	principal: {
		metadata: {},
		contentHash: "",
		providerId: null,
		pluginRevision: null,
		scriptSlug: "script",
		scriptId: SandboxScriptId.make("script-1"),
		subject: {
			type: "user",
			userId: UserId.make("user-1"),
			accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
		},
	},
} as const satisfies SandboxRunInput;

const runtimeHostLayer = Layer.unwrap(
	Effect.gen(function* () {
		const values = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
		const run = Effect.runPromiseWith(yield* Effect.context());
		const read = (key: string) => MutableRef.get(values.ref).get(key) ?? null;
		const write = (key: string, value: string) =>
			MutableRef.update(values.ref, (all) => new Map(all).set(key, value));
		const client = Object.assign(Object.create(null), {
			get: (key: string) => Promise.resolve(read(key)),
			set: (key: string, value: string, ...options: ReadonlyArray<unknown>) =>
				run(
					Effect.sync(() => {
						if (options.includes("NX") && MutableRef.get(values.ref).has(key)) {
							return null;
						}
						write(key, value);
						return "OK";
					}),
				),
		}) satisfies RedisService["Service"]["client"];
		const redis = makeRedisService({
			client,
			get: (key) => Effect.map(Ref.get(values), (all) => all.get(key) ?? null),
			set: (key, value) => Ref.update(values, (all) => new Map(all).set(key, value)),
		});

		return Layer.mergeAll(
			Layer.succeed(RedisService, redis),
			Layer.succeed(ServerRun, { id: "run-1" }),
			FetchHttpClient.layer,
		);
	}),
);

describe("runtime sandbox host functions", () => {
	layer(runtimeHostLayer)((test) => {
		test.effect("round-trips run-scoped cache values", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions;

				yield* host.setCachedValue(input, " answer ", { value: 42 }, 60);
				expect(yield* host.getCachedValue(input, "answer")).toEqual({ value: 42 });
			}),
		);
	});

	layer(runtimeHostLayer)((test) => {
		test.effect("claims persistent values only once", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions;
				const value = { value: { nested: true }, __ryotDurableClaim: "public" };

				expect(yield* host.claimPersistentValue(input, "answer", value, 60)).toEqual({
					claimed: true,
				});
				expect(yield* host.claimPersistentValue(input, "answer", { value: 43 }, 60)).toEqual({
					value,
					claimed: false,
				});
			}),
		);
	});

	layer(runtimeHostLayer)((test) => {
		test.effect("replays a durable persistent claim as the original successful claim", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions;
				const durableInput = {
					...input,
					executionId: "workflow-1-host-0",
					workflowExecutionId: "workflow-1",
				};

				expect(yield* host.claimPersistentValue(durableInput, "answer", { value: 42 }, 60)).toEqual(
					{ claimed: true },
				);
				expect(yield* host.claimPersistentValue(durableInput, "answer", { value: 42 }, 60)).toEqual(
					{ claimed: true },
				);
				expect(
					yield* host.claimPersistentValue(
						{
							...durableInput,
							executionId: "workflow-2-host-0",
							workflowExecutionId: "workflow-2",
						},
						"answer",
						{ value: 43 },
						60,
					),
				).toEqual({ claimed: false, value: { value: 42 } });
			}),
		);
	});

	layer(runtimeHostLayer)((test) => {
		test.effect("validates HTTP calls before execution", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions;
				const error = yield* host.httpCall(input, "", "https://example.com").pipe(Effect.flip);

				expect(error).toEqual({ message: "httpCall expects a non-empty method string" });
			}),
		);
	});

	layer(runtimeHostLayer)((test) => {
		// Port 1 refuses connections, so the request fails without reaching an application.
		test.effect("marks a failed HTTP request as an uncertain external outcome", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions;
				const error = yield* host.httpCall(input, "POST", "http://127.0.0.1:1/").pipe(Effect.flip);

				expect(error).toMatchObject({ data: { code: "external-uncertain" } });
			}),
		);
	});
});
