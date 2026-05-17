import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe } from "vitest";

import { makeRedisService } from "#lib/test-utils/effect";

import { RedisService } from "../redis";
import { ServerRun } from "../server-run";
import { makeRuntimeSandboxApiFunctions } from "./runtime-host-functions";
import type { SandboxRunInput } from "./shared";

const input = {
	context: {},
	metadata: {},
	contentHash: "",
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script-1",
	allowedHostFunctions: [],
	executionId: "execution-1",
	authority: { type: "user", userId: UserId.make("user-1") },
} as const satisfies SandboxRunInput;

const makeLayer = (values: Map<string, string>) => {
	const client = Object.assign(Object.create(null), {
		get: (key: string) => Promise.resolve(values.get(key) ?? null),
		set: (key: string, value: string, ...options: ReadonlyArray<unknown>) =>
			Promise.resolve().then(() => {
				if (options.includes("NX") && values.has(key)) {
					return null;
				}
				values.set(key, value);
				return "OK";
			}),
	}) satisfies RedisService["Service"]["client"];
	const redis = makeRedisService({
		client,
		get: (key) => Effect.succeed(values.get(key) ?? null),
		set: (key, value) => Effect.sync(() => void values.set(key, value)),
	});

	return Layer.mergeAll(
		Layer.succeed(RedisService, redis),
		Layer.succeed(ServerRun, { id: "run-1" }),
		FetchHttpClient.layer,
	);
};

describe("runtime sandbox host functions", () => {
	it.effect("round-trips run-scoped cache values", () =>
		Effect.gen(function* () {
			const host = yield* makeRuntimeSandboxApiFunctions.pipe(Effect.provide(makeLayer(new Map())));

			yield* host.setCachedValue(input, " answer ", { value: 42 }, 60);
			expect(yield* host.getCachedValue(input, "answer")).toEqual({ value: 42 });
		}),
	);

	it.effect("claims persistent values only once", () =>
		Effect.gen(function* () {
			const host = yield* makeRuntimeSandboxApiFunctions.pipe(Effect.provide(makeLayer(new Map())));
			const value = { __ryotDurableClaim: "public", value: { nested: true } };

			expect(yield* host.claimPersistentValue(input, "answer", value, 60)).toEqual({
				claimed: true,
			});
			expect(yield* host.claimPersistentValue(input, "answer", { value: 43 }, 60)).toEqual({
				value,
				claimed: false,
			});
		}),
	);

	it.effect("replays a durable persistent claim as the original successful claim", () =>
		Effect.gen(function* () {
			const values = new Map<string, string>();
			const host = yield* makeRuntimeSandboxApiFunctions.pipe(Effect.provide(makeLayer(values)));
			const durableInput = {
				...input,
				executionId: "workflow-1-host-0",
				workflowExecutionId: "workflow-1",
			};

			expect(yield* host.claimPersistentValue(durableInput, "answer", { value: 42 }, 60)).toEqual({
				claimed: true,
			});
			expect(yield* host.claimPersistentValue(durableInput, "answer", { value: 42 }, 60)).toEqual({
				claimed: true,
			});
			expect(
				yield* host.claimPersistentValue(
					{ ...durableInput, executionId: "workflow-2-host-0", workflowExecutionId: "workflow-2" },
					"answer",
					{ value: 43 },
					60,
				),
			).toEqual({ claimed: false, value: { value: 42 } });
		}),
	);

	it.effect("validates HTTP calls before execution", () =>
		Effect.gen(function* () {
			const host = yield* makeRuntimeSandboxApiFunctions.pipe(Effect.provide(makeLayer(new Map())));
			const error = yield* host.httpCall(input, "", "https://example.com").pipe(Effect.flip);

			expect(error).toEqual({ message: "httpCall expects a non-empty method string" });
		}),
	);
});
