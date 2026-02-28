import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { describe } from "vitest";

import { bindSandboxHostFunctions } from "./bridge-adapter";
import type { SandboxHostImplementationMap, SandboxRunInput } from "./shared";

const input: SandboxRunInput = {
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
};

const makeImplementations = (
	overrides: Partial<SandboxHostImplementationMap> = {},
): SandboxHostImplementationMap => ({
	log: () => Effect.fail({ message: "unused" }),
	span: () => Effect.fail({ message: "unused" }),
	httpCall: () => Effect.fail({ message: "unused" }),
	emitSignal: () => Effect.fail({ message: "unused" }),
	createEvents: () => Effect.fail({ message: "unused" }),
	getCachedValue: () => Effect.fail({ message: "unused" }),
	setCachedValue: () => Effect.fail({ message: "unused" }),
	getPluginConfig: () => Effect.fail({ message: "unused" }),
	getSystemConfig: () => Effect.fail({ message: "unused" }),
	getEntitySchemas: () => Effect.fail({ message: "unused" }),
	listEventSchemas: () => Effect.fail({ message: "unused" }),
	listIntegrations: () => Effect.fail({ message: "unused" }),
	sendNotification: () => Effect.fail({ message: "unused" }),
	executeQueryEngine: () => Effect.fail({ message: "unused" }),
	getUserPreferences: () => Effect.fail({ message: "unused" }),
	ensureUserEntities: () => Effect.fail({ message: "unused" }),
	claimPersistentValue: () => Effect.fail({ message: "unused" }),
	upsertGlobalEntities: () => Effect.fail({ message: "unused" }),
	getCurrentIntegration: () => Effect.fail({ message: "unused" }),
	changeUserRelationships: () => Effect.fail({ message: "unused" }),
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
				error: "2.body: Expected string | undefined, got 42",
			});
			expect(
				yield* bound.httpCall(["POST", "https://example.com", { allowInsecureConnections: "yes" }]),
			).toEqual({
				success: false,
				error: '2.allowInsecureConnections: Expected boolean | undefined, got "yes"',
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
				error: '0.0.level: Expected "debug" | "info" | "warning" | "error", got "verbose"',
			});
			expect(yield* bound.span([[{ name: "" }]])).toEqual({
				success: false,
				error: '0.0.name: Expected a value with a length of at least 1, got ""',
			});
			expect(yield* bound.log([[], "surplus"])).toEqual({
				success: false,
				error: "log received an invalid number of arguments",
			});
			expect(calls).toBe(0);
		}),
	);

	it.effect("preserves HTTP failure details from a typed implementation", () =>
		Effect.gen(function* () {
			const implementations = makeImplementations({
				httpCall: () =>
					Effect.fail({ message: "HTTP 429", data: { body: "rate limited", status: 429 } }),
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* bound.httpCall(["GET", "https://example.com"]);

			expect(result).toEqual({
				success: false,
				error: "HTTP 429",
				data: { body: "rate limited", status: 429 },
			});
		}),
	);

	it.effect("validates and narrows domain arguments before dispatch", () =>
		Effect.gen(function* () {
			const calls: Array<{ fnName: string; value: unknown }> = [];
			const implementations = makeImplementations({
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

			expect(
				yield* bound.createEvents([
					[{ entityId: "e-1", eventSchemaSlug: "es-1", properties: { watched: true } }],
				]),
			).toEqual({ error: "reached", success: false });
			expect(yield* bound.createEvents(["nope"])).toEqual({
				success: false,
				error: '0: Expected array, got "nope"',
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
				error: "1.maximumTotal: Expected a value greater than or equal to 0, got -1",
			});

			expect(yield* bound.listIntegrations([{ provider: "plugin_defined_provider" }])).toEqual({
				error: "reached",
				success: false,
			});
			expect(yield* bound.listIntegrations([{ provider: 1 }])).toEqual({
				success: false,
				error: "0.provider: Expected string | undefined, got 1",
			});

			expect(yield* bound.executeQueryEngine([() => undefined])).toEqual({
				success: false,
				error: "0: Expected null | string | number | boolean | array | object, got () => undefined",
			});

			expect(calls).toEqual([
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

	it.effect("validates user relationship batches without accepting a user id", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				changeUserRelationships: (runInput, batches) => {
					calls.push({ runInput, batches });
					return Effect.succeed([{ created: 2, deleted: 0 }]);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const batch = {
				deletes: [],
				creates: [
					{
						properties: {},
						sourceEntityId: "media-1",
						targetEntityId: "library-1",
						relationshipSchemaSlug: "in-library",
					},
				],
			};

			expect(yield* bound.changeUserRelationships([[batch]])).toEqual({
				data: [{ created: 2, deleted: 0 }],
				success: true,
			});
			expect(calls).toEqual([{ runInput: input, batches: [batch] }]);
			expect(
				yield* bound.changeUserRelationships([[{ ...batch, userId: "caller-selected" }]]),
			).toEqual({
				success: false,
				error: '0.0.userId: Unexpected key with value "caller-selected"',
			});
		}),
	);

	it.effect("validates user entity ensure batches without accepting caller-owned authority", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				ensureUserEntities: (runInput, items) => {
					calls.push({ runInput, items });
					return Effect.succeed([{ entityId: "entity-1", wasInserted: true }]);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const item = { properties: {}, name: "Library", entitySchemaSlug: "library" };

			expect(yield* bound.ensureUserEntities([[item]])).toEqual({
				success: true,
				data: [{ entityId: "entity-1", wasInserted: true }],
			});
			expect(calls).toEqual([{ runInput: input, items: [item] }]);
			expect(yield* bound.ensureUserEntities([[{ ...item, userId: "caller-selected" }]])).toEqual({
				success: false,
				error: '0.0.userId: Unexpected key with value "caller-selected"',
			});
			expect(
				yield* bound.ensureUserEntities([[{ ...item, pluginSlug: "caller-selected" }]]),
			).toEqual({
				success: false,
				error: '0.0.pluginSlug: Unexpected key with value "caller-selected"',
			});
			expect(calls).toHaveLength(1);
		}),
	);

	it.effect(
		"dispatches domain calls with the server-provided run input and rejects surplus arguments",
		() =>
			Effect.gen(function* () {
				let calls = 0;
				let receivedUserId: string | null = "unset";
				const implementations = makeImplementations({
					getCurrentIntegration: (runInput) => {
						calls += 1;
						receivedUserId = "userId" in runInput.authority ? runInput.authority.userId : null;
						return Effect.fail({ message: "reached" });
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				yield* bound.getCurrentIntegration([]);
				const surplus = yield* bound.getCurrentIntegration(["integration-1"]);

				expect(surplus).toEqual({
					success: false,
					error: "getCurrentIntegration received an invalid number of arguments",
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
			).toEqual({
				success: false,
				error: '0.recipientUserIds: Unexpected key with value ["user-2"]',
			});
			expect(yield* bound.sendNotification(["   "])).toEqual({
				success: false,
				error: '0: Expected a value with a length of at least 1, got ""',
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
			expect(yield* bound.listIntegrations([null])).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* bound.getPluginConfig([[null]])).toEqual({
				success: false,
				error: "0.0: Expected string, got null",
			});
			expect(yield* bound.getSystemConfig([[null]])).toEqual({
				success: false,
				error: "0.0: Expected string, got null",
			});
			expect(calls).toEqual([
				{ fnName: "httpCall", value: undefined },
				{ fnName: "listIntegrations", value: undefined },
			]);
		}),
	);

	it.effect("forwards the per-call insecure connection opt-in without changing the default", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				httpCall: (_runInput, _method, _url, options) => {
					calls.push(options);
					return Effect.fail({ message: "reached" });
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			yield* bound.httpCall(["GET", "https://example.com"]);
			yield* bound.httpCall(["GET", "https://example.com", { allowInsecureConnections: true }]);

			expect(calls).toEqual([undefined, { allowInsecureConnections: true }]);
		}),
	);

	it.effect("validates complete claim and config tuples", () =>
		Effect.gen(function* () {
			const calls: Array<{ fnName: string; value: unknown }> = [];
			const implementations = makeImplementations({
				claimPersistentValue: (_runInput, key, value, ttlSeconds) => {
					calls.push({ fnName: "claimPersistentValue", value: { key, ttlSeconds, value } });
					return Effect.succeed({ claimed: true as const });
				},
				getPluginConfig: (_runInput, keys) => {
					calls.push({ fnName: "getPluginConfig", value: keys });
					return Effect.succeed({ apiToken: "token" });
				},
				getSystemConfig: (_runInput, keys) => {
					calls.push({ fnName: "getSystemConfig", value: keys });
					return Effect.succeed({ timezone: "UTC" });
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(yield* bound.claimPersistentValue(["lock", { owner: "user-1" }, 60])).toEqual({
				success: true,
				data: { claimed: true },
			});
			expect(yield* bound.getPluginConfig([["apiToken"]])).toEqual({
				success: true,
				data: { apiToken: "token" },
			});
			expect(yield* bound.getSystemConfig([["timezone"]])).toEqual({
				success: true,
				data: { timezone: "UTC" },
			});
			expect(yield* bound.claimPersistentValue(["lock", { owner: "user-1" }, 1.5])).toEqual({
				success: false,
				error: "2: Expected an integer, got 1.5",
			});
			expect(yield* bound.setCachedValue(["lock", { owner: "user-1" }, 1.5])).toEqual({
				success: false,
				error: "2: Expected an integer, got 1.5",
			});
			expect(yield* bound.getPluginConfig([["apiToken"], "surplus"])).toEqual({
				success: false,
				error: "getPluginConfig received an invalid number of arguments",
			});
			expect(yield* bound.getSystemConfig([["timezone"], "surplus"])).toEqual({
				success: false,
				error: "getSystemConfig received an invalid number of arguments",
			});
			expect(calls).toEqual([
				{
					fnName: "claimPersistentValue",
					value: { key: "lock", ttlSeconds: 60, value: { owner: "user-1" } },
				},
				{ fnName: "getPluginConfig", value: ["apiToken"] },
				{ fnName: "getSystemConfig", value: ["timezone"] },
			]);
		}),
	);
});
