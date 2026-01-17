import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { describe } from "vitest";

import { bindSandboxHostFunctions } from "./bridge-adapter";
import type { SandboxHostImplementationMap, SandboxRunInput } from "./shared";

const input: SandboxRunInput = {
	context: {},
	metadata: {},
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script-1",
	scriptIsBuiltin: false,
	allowedHostFunctions: [],
	executionId: "execution-1",
	cacheNamespace: "script-1",
	authority: { type: "user", userId: UserId.make("user-1") },
};

const makeImplementations = (
	overrides: Partial<SandboxHostImplementationMap> = {},
): SandboxHostImplementationMap => ({
	log: () => Effect.fail({ message: "unused" }),
	span: () => Effect.fail({ message: "unused" }),
	httpCall: () => Effect.fail({ message: "unused" }),
	getEntity: () => Effect.fail({ message: "unused" }),
	emitSignal: () => Effect.fail({ message: "unused" }),
	listEvents: () => Effect.fail({ message: "unused" }),
	createEvents: () => Effect.fail({ message: "unused" }),
	getIntegration: () => Effect.fail({ message: "unused" }),
	getCachedValue: () => Effect.fail({ message: "unused" }),
	setCachedValue: () => Effect.fail({ message: "unused" }),
	getEntitySchema: () => Effect.fail({ message: "unused" }),
	listEventSchemas: () => Effect.fail({ message: "unused" }),
	listIntegrations: () => Effect.fail({ message: "unused" }),
	sendNotification: () => Effect.fail({ message: "unused" }),
	claimCachedValue: () => Effect.fail({ message: "unused" }),
	getAppConfigValue: () => Effect.fail({ message: "unused" }),
	executeQueryEngine: () => Effect.fail({ message: "unused" }),
	getUserPreferences: () => Effect.fail({ message: "unused" }),
	upsertGlobalEntities: () => Effect.fail({ message: "unused" }),
	upsertGlobalRelationships: () => Effect.fail({ message: "unused" }),
	...overrides,
});

const promiseImplementation: SandboxHostImplementationMap["getCachedValue"] = () =>
	// @ts-expect-error implementation methods return Effects, not Promises.
	Promise.resolve(null);
void promiseImplementation;

describe("bindSandboxHostFunctions", () => {
	it.effect("keeps the bound bridge in Effect", () =>
		Effect.gen(function* () {
			const result = bindSandboxHostFunctions(makeImplementations(), input).getCachedValue(["key"]);
			expect(Effect.isEffect(result)).toBe(true);
			expect(result).not.toBeInstanceOf(Promise);
			expect(yield* result).toEqual({ error: "unused", success: false });
		}),
	);

	it.effect("decodes RPC arguments before calling a typed core implementation", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				setCachedValue: (runInput, key, value, expiry) => {
					calls.push({ runInput, key, value, expiry });
					return Effect.succeed(null);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* bound.setCachedValue(["answer", { value: 42 }, 60]);

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
					return Effect.fail({ message: "unexpected" });
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* bound.httpCall(["POST", "https://example.com", { body: 42 }]);

			expect(result).toEqual({
				success: false,
				error: "httpCall options.body must be a string",
			});
			expect(yield* bound.getUserPreferences(["unexpected"])).toEqual({
				success: false,
				error: "getUserPreferences received an invalid number of arguments",
			});
			expect(calls).toBe(0);
		}),
	);

	it.effect("rejects invalid observability batches before dispatch", () =>
		Effect.gen(function* () {
			let calls = 0;
			const implementations = makeImplementations({
				log: () => {
					calls += 1;
					return Effect.succeed(null);
				},
				span: () => {
					calls += 1;
					return Effect.succeed(null);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(yield* bound.log([[{ level: "verbose", message: "nope" }]])).toEqual({
				success: false,
				error: "log expects an array of valid log entries",
			});
			expect(yield* bound.span([[{ name: "" }]])).toEqual({
				success: false,
				error: "span expects an array of valid span entries",
			});
			expect(yield* bound.log([[], "surplus"])).toEqual({
				success: false,
				error: "log received an invalid number of arguments",
			});
			expect(calls).toBe(0);
		}),
	);

	it.effect("preserves HTTP status details from a typed implementation", () =>
		Effect.gen(function* () {
			const implementations = makeImplementations({
				httpCall: () => Effect.fail({ message: "HTTP 429", data: { status: 429 } }),
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* bound.httpCall(["GET", "https://example.com"]);

			expect(result).toEqual({ success: false, error: "HTTP 429", data: { status: 429 } });
		}),
	);

	it.effect("validates and narrows domain arguments before dispatch", () =>
		Effect.gen(function* () {
			const calls: Array<{ fnName: string; value: unknown }> = [];
			const implementations = makeImplementations({
				getEntity: (_runInput, entityId) => {
					calls.push({ fnName: "getEntity", value: entityId });
					return Effect.fail({ message: "reached" });
				},
				createEvents: (_runInput, items) => {
					calls.push({ fnName: "createEvents", value: items });
					return Effect.fail({ message: "reached" });
				},
				upsertGlobalEntities: (_runInput, items, options) => {
					calls.push({ fnName: "upsertGlobalEntities", value: { items, options } });
					return Effect.succeed([{ status: "skipped" as const }]);
				},
				listIntegrations: (_runInput, options) => {
					calls.push({ fnName: "listIntegrations", value: options });
					return Effect.fail({ message: "reached" });
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(yield* bound.getEntity(["entity-1"])).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* bound.getEntity([42])).toEqual({
				success: false,
				error: "getEntity expects a non-empty entityId string",
			});

			expect(
				yield* bound.createEvents([
					[{ entityId: "e-1", eventSchemaSlug: "es-1", properties: { watched: true } }],
				]),
			).toEqual({ error: "reached", success: false });
			expect(yield* bound.createEvents(["nope"])).toEqual({
				success: false,
				error: "createEvents expects an array of event items",
			});
			expect(
				yield* bound.upsertGlobalEntities([
					[
						{
							name: "Entity",
							properties: {},
							populatedAt: null,
							externalId: "external-1",
							entitySchemaSlug: "person",
						},
					],
					{ maximumTotal: 0 },
				]),
			).toEqual({ data: [{ status: "skipped" }], success: true });
			expect(yield* bound.upsertGlobalEntities([[], { maximumTotal: -1 }])).toEqual({
				success: false,
				error: "upsertGlobalEntities expects an array of valid entity items",
			});

			expect(yield* bound.listIntegrations([{ provider: "plugin_defined_provider" }])).toEqual({
				error: "reached",
				success: false,
			});
			expect(yield* bound.listIntegrations([{ provider: 1 }])).toEqual({
				success: false,
				error: "listIntegrations received invalid options",
			});

			expect(yield* bound.executeQueryEngine([() => undefined])).toEqual({
				success: false,
				error: "executeQueryEngine expects a JSON query document",
			});

			expect(calls).toEqual([
				{ fnName: "getEntity", value: "entity-1" },
				{
					fnName: "createEvents",
					value: [{ entityId: "e-1", eventSchemaSlug: "es-1", properties: { watched: true } }],
				},
				{
					fnName: "upsertGlobalEntities",
					value: {
						options: { maximumTotal: 0 },
						items: [
							{
								name: "Entity",
								properties: {},
								populatedAt: null,
								externalId: "external-1",
								entitySchemaSlug: "person",
							},
						],
					},
				},
				{ fnName: "listIntegrations", value: { provider: "plugin_defined_provider" } },
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
						receivedUserId = "userId" in runInput.authority ? runInput.authority.userId : null;
						return Effect.fail({ message: "reached" });
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				yield* bound.getIntegration([]);
				const surplus = yield* bound.getIntegration(["integration-1"]);

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
					return Effect.fail({ message: "unexpected" });
				},
				sendNotification: () => {
					calls += 1;
					return Effect.fail({ message: "unexpected" });
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(
				yield* bound.emitSignal([
					{
						discriminator: "review-1",
						schemaSlug: "review.created",
						recipientUserIds: ["user-2"],
						properties: { message: "trace" },
					},
				]),
			).toEqual({ success: false, error: "emitSignal expects a valid signal request" });
			expect(yield* bound.sendNotification(["   "])).toEqual({
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
					return Effect.fail({ message: "reached" });
				},
				listEvents: (_runInput, options) => {
					calls.push({ fnName: "listEvents", value: options });
					return Effect.fail({ message: "reached" });
				},
				listIntegrations: (_runInput, options) => {
					calls.push({ fnName: "listIntegrations", value: options });
					return Effect.fail({ message: "reached" });
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(yield* bound.httpCall(["GET", "https://example.com", null])).toEqual({
				error: "reached",
				success: false,
			});
			expect(yield* bound.listEvents([null])).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* bound.listIntegrations([null])).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* bound.getAppConfigValue([null])).toEqual({
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
					return Effect.succeed({ claimed: true as const });
				},
				getAppConfigValue: (_runInput, key) => {
					calls.push({ fnName: "getAppConfigValue", value: key });
					return Effect.succeed("UTC");
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(yield* bound.claimCachedValue(["lock", { owner: "user-1" }, 60])).toEqual({
				data: { claimed: true },
				success: true,
			});
			expect(yield* bound.getAppConfigValue(["timezone"])).toEqual({
				data: "UTC",
				success: true,
			});
			expect(yield* bound.claimCachedValue(["lock", { owner: "user-1" }, 1.5])).toEqual({
				success: false,
				error: "claimCachedValue expects a positive integer ttlSeconds",
			});
			expect(yield* bound.getAppConfigValue(["timezone", "surplus"])).toEqual({
				success: false,
				error: "getAppConfigValue received an invalid number of arguments",
			});
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
