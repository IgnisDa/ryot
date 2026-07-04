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
	httpCall: () => Promise.resolve(apiFailure("unused")),
	getEntity: () => Promise.resolve(apiFailure("unused")),
	emitSignal: () => Promise.resolve(apiFailure("unused")),
	listEvents: () => Promise.resolve(apiFailure("unused")),
	createEvents: () => Promise.resolve(apiFailure("unused")),
	getIntegration: () => Promise.resolve(apiFailure("unused")),
	getCachedValue: () => Promise.resolve(apiFailure("unused")),
	setCachedValue: () => Promise.resolve(apiFailure("unused")),
	getEntitySchema: () => Promise.resolve(apiFailure("unused")),
	listEventSchemas: () => Promise.resolve(apiFailure("unused")),
	listIntegrations: () => Promise.resolve(apiFailure("unused")),
	sendNotification: () => Promise.resolve(apiFailure("unused")),
	claimCachedValue: () => Promise.resolve(apiFailure("unused")),
	getAppConfigValue: () => Promise.resolve(apiFailure("unused")),
	executeQueryEngine: () => Promise.resolve(apiFailure("unused")),
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

	it.effect("validates and narrows domain arguments before dispatch", () =>
		Effect.gen(function* () {
			const calls: Array<{ fnName: string; value: unknown }> = [];
			const implementations = makeImplementations({
				getEntity: (_runInput, entityId) => {
					calls.push({ fnName: "getEntity", value: entityId });
					return Promise.resolve(apiFailure("reached"));
				},
				createEvents: (_runInput, items) => {
					calls.push({ fnName: "createEvents", value: items });
					return Promise.resolve(apiFailure("reached"));
				},
				listIntegrations: (_runInput, options) => {
					calls.push({ fnName: "listIntegrations", value: options });
					return Promise.resolve(apiFailure("reached"));
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(yield* Effect.promise(() => bound.getEntity(["entity-1"]))).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* Effect.promise(() => bound.getEntity([42]))).toEqual({
				success: false,
				error: "getEntity expects a non-empty entityId string",
			});

			expect(
				yield* Effect.promise(() =>
					bound.createEvents([
						[{ entityId: "e-1", eventSchemaSlug: "es-1", properties: { watched: true } }],
					]),
				),
			).toEqual({ error: "reached", success: false });
			expect(yield* Effect.promise(() => bound.createEvents(["nope"]))).toEqual({
				success: false,
				error: "createEvents expects an array of event items",
			});

			expect(
				yield* Effect.promise(() => bound.listIntegrations([{ provider: "plex_yank" }])),
			).toEqual({ error: "reached", success: false });
			expect(
				yield* Effect.promise(() => bound.listIntegrations([{ provider: "not-real" }])),
			).toEqual({ success: false, error: "listIntegrations received invalid options" });

			expect(yield* Effect.promise(() => bound.executeQueryEngine([() => undefined]))).toEqual({
				success: false,
				error: "executeQueryEngine expects a JSON query document",
			});

			expect(calls).toEqual([
				{ fnName: "getEntity", value: "entity-1" },
				{
					fnName: "createEvents",
					value: [{ entityId: "e-1", eventSchemaSlug: "es-1", properties: { watched: true } }],
				},
				{ fnName: "listIntegrations", value: { provider: "plex_yank" } },
			]);
		}),
	);

	it.effect(
		"dispatches domain calls with the server-provided run input and rejects surplus arguments",
		() =>
			Effect.gen(function* () {
				let calls = 0;
				let receivedUserId: string | null = "unset";
				const implementations = makeImplementations({
					getIntegration: (runInput) => {
						calls += 1;
						receivedUserId = runInput.userId;
						return Promise.resolve(apiFailure("reached"));
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				yield* Effect.promise(() => bound.getIntegration(["integration-1"]));
				const surplus = yield* Effect.promise(() =>
					bound.getIntegration(["integration-1", "user-2", { userId: "user-2" }]),
				);

				expect(surplus).toEqual({
					success: false,
					error: "getIntegration received an invalid number of arguments",
				});
				expect(calls).toBe(1);
				expect(receivedUserId).toBe("user-1");
			}),
	);

	it.effect("rejects caller-selected signal recipients and invalid notification messages", () =>
		Effect.gen(function* () {
			let calls = 0;
			const implementations = makeImplementations({
				emitSignal: () => {
					calls += 1;
					return Promise.resolve(apiFailure("unexpected"));
				},
				sendNotification: () => {
					calls += 1;
					return Promise.resolve(apiFailure("unexpected"));
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(
				yield* Effect.promise(() =>
					bound.emitSignal([
						{
							discriminator: "review-1",
							schemaSlug: "review.created",
							recipientUserIds: ["user-2"],
							properties: { message: "trace" },
						},
					]),
				),
			).toEqual({ success: false, error: "emitSignal expects a valid signal request" });
			expect(yield* Effect.promise(() => bound.sendNotification(["   "]))).toEqual({
				success: false,
				error: "sendNotification expects a non-empty message string",
			});
			expect(calls).toBe(0);
		}),
	);

	it.effect("normalizes transport null only for optional tuple arguments", () =>
		Effect.gen(function* () {
			const calls: Array<{ fnName: string; value: unknown }> = [];
			const implementations = makeImplementations({
				httpCall: (_runInput, _method, _url, options) => {
					calls.push({ fnName: "httpCall", value: options });
					return Promise.resolve(apiFailure("reached"));
				},
				listEvents: (_runInput, options) => {
					calls.push({ fnName: "listEvents", value: options });
					return Promise.resolve(apiFailure("reached"));
				},
				listIntegrations: (_runInput, options) => {
					calls.push({ fnName: "listIntegrations", value: options });
					return Promise.resolve(apiFailure("reached"));
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(
				yield* Effect.promise(() => bound.httpCall(["GET", "https://example.com", null])),
			).toEqual({ error: "reached", success: false });
			expect(yield* Effect.promise(() => bound.listEvents([null]))).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* Effect.promise(() => bound.listIntegrations([null]))).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* Effect.promise(() => bound.getAppConfigValue([null]))).toEqual({
				success: false,
				error: "getAppConfigValue expects a non-empty key string",
			});
			expect(calls).toEqual([
				{ fnName: "httpCall", value: undefined },
				{ fnName: "listEvents", value: undefined },
				{ fnName: "listIntegrations", value: undefined },
			]);
		}),
	);

	it.effect("validates complete claim and app config tuples", () =>
		Effect.gen(function* () {
			const calls: Array<{ fnName: string; value: unknown }> = [];
			const implementations = makeImplementations({
				claimCachedValue: (_runInput, key, value, ttlSeconds) => {
					calls.push({ fnName: "claimCachedValue", value: { key, ttlSeconds, value } });
					return Promise.resolve(apiSuccess({ claimed: true }));
				},
				getAppConfigValue: (_runInput, key) => {
					calls.push({ fnName: "getAppConfigValue", value: key });
					return Promise.resolve(apiSuccess("UTC"));
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(
				yield* Effect.promise(() => bound.claimCachedValue(["lock", { owner: "user-1" }, 60])),
			).toEqual({ data: { claimed: true }, success: true });
			expect(yield* Effect.promise(() => bound.getAppConfigValue(["timezone"]))).toEqual({
				data: "UTC",
				success: true,
			});
			expect(
				yield* Effect.promise(() => bound.claimCachedValue(["lock", { owner: "user-1" }, 1.5])),
			).toEqual({
				success: false,
				error: "claimCachedValue expects a positive integer ttlSeconds",
			});
			expect(yield* Effect.promise(() => bound.getAppConfigValue(["timezone", "surplus"]))).toEqual(
				{
					success: false,
					error: "getAppConfigValue received an invalid number of arguments",
				},
			);
			expect(calls).toEqual([
				{
					fnName: "claimCachedValue",
					value: { key: "lock", ttlSeconds: 60, value: { owner: "user-1" } },
				},
				{ fnName: "getAppConfigValue", value: "timezone" },
			]);
		}),
	);
});
