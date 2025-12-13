import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { bindSandboxHostFunctions } from "./bridge-adapter";
import {
	apiFailure,
	apiSuccess,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";

const input: SandboxRunInput = {
	context: {},
	metadata: {},
	userId: "user-1",
	compiledCode: "",
	compiledFormat: 1,
	driverName: "main",
	scriptId: "script-1",
	scriptIsBuiltin: false,
	allowedHostFunctions: [],
	executionId: "execution-1",
};

const makeImplementations = (
	overrides: Partial<SandboxHostImplementationMap> = {},
): SandboxHostImplementationMap => ({
	getEntity: () => Promise.resolve(null),
	listEvents: () => Promise.resolve(null),
	createEvents: () => Promise.resolve(null),
	getIntegration: () => Promise.resolve(null),
	getEntitySchema: () => Promise.resolve(null),
	listEventSchemas: () => Promise.resolve(null),
	listIntegrations: () => Promise.resolve(null),
	executeQueryEngine: () => Promise.resolve(null),
	httpCall: () => Promise.resolve(apiFailure("unused")),
	getCachedValue: () => Promise.resolve(apiFailure("unused")),
	setCachedValue: () => Promise.resolve(apiFailure("unused")),
	claimCachedValue: () => Promise.resolve(apiFailure("unused")),
	getAppConfigValue: () => Promise.resolve(apiFailure("unused")),
	getUserPreferences: () => Promise.resolve(apiFailure("unused")),
	...overrides,
});

describe("bindSandboxHostFunctions", () => {
	it.effect("decodes RPC arguments before calling a typed core implementation", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				setCachedValue: (runInput, key, value, expiry) => {
					calls.push({ runInput, key, value, expiry });
					return Promise.resolve(apiSuccess(null));
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* Effect.promise(() =>
				bound.setCachedValue(["answer", { value: 42 }, 60]),
			);

			expect(result).toEqual({ data: null, success: true });
			expect(calls).toEqual([{ runInput: input, key: "answer", value: { value: 42 }, expiry: 60 }]);
		}),
	);

	it.effect("returns a host failure without invoking an implementation for invalid arguments", () =>
		Effect.gen(function* () {
			let calls = 0;
			const implementations = makeImplementations({
				httpCall: () => {
					calls += 1;
					return Promise.resolve(apiFailure("unexpected"));
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* Effect.promise(() =>
				bound.httpCall(["POST", "https://example.com", { body: 42 }]),
			);

			expect(result).toEqual({
				success: false,
				error: "httpCall options.body must be a string",
			});
			expect(yield* Effect.promise(() => bound.getUserPreferences(["unexpected"]))).toEqual({
				success: false,
				error: "getUserPreferences received an invalid number of arguments",
			});
			expect(calls).toBe(0);
		}),
	);

	it.effect("preserves HTTP status details from a typed implementation", () =>
		Effect.gen(function* () {
			const implementations = makeImplementations({
				httpCall: () =>
					Promise.resolve({ success: false, error: "HTTP 429", data: { status: 429 } }),
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* Effect.promise(() => bound.httpCall(["GET", "https://example.com"]));

			expect(result).toEqual({ success: false, error: "HTTP 429", data: { status: 429 } });
		}),
	);
});
