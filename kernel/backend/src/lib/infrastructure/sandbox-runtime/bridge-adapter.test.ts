import { expect, it } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { describe } from "vitest";

import { bindSandboxHostFunctions } from "./bridge-adapter";
import type { SandboxHostImplementationMap, SandboxRunInput } from "./shared";

const input: SandboxRunInput = {
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	executionId: "execution-1",
	principal: {
		metadata: {},
		contentHash: "",
		providerId: null,
		scriptSlug: "script",
		pluginRevision: null,
		scriptId: SandboxScriptId.make("script-1"),
		subject: { type: "user", userId: UserId.make("user-1") },
	},
};

const makeImplementations = (
	overrides: Partial<SandboxHostImplementationMap> = {},
): SandboxHostImplementationMap => ({
	log: () => Effect.fail({ message: "unused" }),
	span: () => Effect.fail({ message: "unused" }),
	httpCall: () => Effect.fail({ message: "unused" }),
	emitSignal: () => Effect.fail({ message: "unused" }),
	createEvents: () => Effect.fail({ message: "unused" }),
	executeRyotql: () => Effect.fail({ message: "unused" }),
	getCachedValue: () => Effect.fail({ message: "unused" }),
	setCachedValue: () => Effect.fail({ message: "unused" }),
	getPluginConfig: () => Effect.fail({ message: "unused" }),
	getSystemConfig: () => Effect.fail({ message: "unused" }),
	getEntitySchemas: () => Effect.fail({ message: "unused" }),
	listEventSchemas: () => Effect.fail({ message: "unused" }),
	listIntegrations: () => Effect.fail({ message: "unused" }),
	sendNotification: () => Effect.fail({ message: "unused" }),
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
			expect(yield* result).toEqual({ success: false, error: "unused" });
		}),
	);

	it.effect("decodes RPC arguments before calling a typed core implementation", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				setCachedValue: (runInput, key, value, expiry) => {
					calls.push({ key, value, expiry, runInput });
					return Effect.succeed(null);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* bound.setCachedValue(["answer", { value: 42 }, 60]);

			expect(result).toEqual({ data: null, success: true });
			expect(calls).toEqual([{ expiry: 60, key: "answer", runInput: input, value: { value: 42 } }]);
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

			expect(result).toEqual({ success: false, error: "2.body: Expected string | undefined" });
			expect(
				yield* bound.httpCall(["POST", "https://example.com", { allowInsecureConnections: "yes" }]),
			).toEqual({
				success: false,
				error: "2.allowInsecureConnections: Expected boolean | undefined",
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

			expect(yield* bound.log([[{ message: "nope", level: "verbose" }]])).toEqual({
				success: false,
				error: '0.0.level: Expected "debug" | "info" | "warning" | "error"',
			});
			expect(yield* bound.span([[{ name: "" }]])).toEqual({
				success: false,
				error: "0.0.name: Expected a value with a length of at least 1",
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
					Effect.fail({
						message: "HTTP 429",
						data: { status: 429, body: "rate limited", headers: { "retry-after": "10" } },
					}),
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const result = yield* bound.httpCall(["GET", "https://example.com"]);

			expect(result).toEqual({
				success: false,
				error: "HTTP 429",
				data: { status: 429, body: "rate limited", headers: { "retry-after": "10" } },
			});
		}),
	);

	it.effect("validates and narrows domain arguments before dispatch", () =>
		Effect.gen(function* () {
			const calls: Array<{ fnName: string; value: unknown }> = [];
			const implementations = makeImplementations({
				createEvents: (_runInput, items) => {
					calls.push({ value: items, fnName: "createEvents" });
					return Effect.fail({ message: "reached" });
				},
				listIntegrations: (_runInput, options) => {
					calls.push({ value: options, fnName: "listIntegrations" });
					return Effect.fail({ message: "reached" });
				},
				upsertGlobalEntities: (_runInput, items, options) => {
					calls.push({ value: { items, options }, fnName: "upsertGlobalEntities" });
					return Effect.succeed([{ status: "skipped" as const }]);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(
				yield* bound.createEvents([
					[{ entityId: "e-1", eventSchemaSlug: "es-1", properties: { watched: true } }],
				]),
			).toEqual({ success: false, error: "reached" });
			expect(yield* bound.createEvents(["nope"])).toEqual({
				success: false,
				error: "0: Expected array",
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
			).toEqual({ success: true, data: [{ status: "skipped" }] });
			expect(yield* bound.upsertGlobalEntities([[], { maximumTotal: -1 }])).toEqual({
				success: false,
				error: "1.maximumTotal: Expected a value greater than or equal to 0",
			});

			expect(yield* bound.listIntegrations([{ provider: "plugin_defined_provider" }])).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* bound.listIntegrations([{ provider: 1 }])).toEqual({
				success: false,
				error: "0.provider: Expected string | undefined",
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
					calls.push({ batches, runInput });
					return Effect.succeed([{ created: 2, deleted: 0 }]);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const batch = {
				deletes: [],
				creates: [
					{
						properties: {},
						sourceEntityId: "example-1",
						targetEntityId: "library-1",
						relationshipSchemaSlug: "in-media-library",
					},
				],
			};

			expect(yield* bound.changeUserRelationships([[batch]])).toEqual({
				success: true,
				data: [{ created: 2, deleted: 0 }],
			});
			expect(calls).toEqual([{ runInput: input, batches: [batch] }]);
			expect(
				yield* bound.changeUserRelationships([[{ ...batch, userId: "caller-selected" }]]),
			).toEqual({ success: false, error: "0.0.userId: Expected no excess property" });
		}),
	);

	it.effect("validates user entity ensure batches without accepting caller-owned subject", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				ensureUserEntities: (runInput, items) => {
					calls.push({ items, runInput });
					return Effect.succeed([{ wasInserted: true, entityId: "entity-1" }]);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const item = { properties: {}, name: "Library", entitySchemaSlug: "media-library" };

			expect(yield* bound.ensureUserEntities([[item]])).toEqual({
				success: true,
				data: [{ wasInserted: true, entityId: "entity-1" }],
			});
			expect(calls).toEqual([{ items: [item], runInput: input }]);
			expect(yield* bound.ensureUserEntities([[{ ...item, userId: "caller-selected" }]])).toEqual({
				success: false,
				error: "0.0.userId: Expected no excess property",
			});
			expect(
				yield* bound.ensureUserEntities([[{ ...item, pluginSlug: "caller-selected" }]]),
			).toEqual({ success: false, error: "0.0.pluginSlug: Expected no excess property" });
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
						receivedUserId =
							"userId" in runInput.principal.subject ? runInput.principal.subject.userId : null;
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
			).toEqual({ success: false, error: "0.recipientUserIds: Expected no excess property" });
			expect(yield* bound.sendNotification(["   "])).toEqual({
				success: false,
				error: "0: Expected a value with a length of at least 1",
			});
			expect(calls).toBe(0);
		}),
	);

	it.effect("normalizes transport null only for optional tuple arguments", () =>
		Effect.gen(function* () {
			const calls: Array<{ fnName: string; value: unknown }> = [];
			const implementations = makeImplementations({
				httpCall: (_runInput, _method, _url, options) => {
					calls.push({ value: options, fnName: "httpCall" });
					return Effect.fail({ message: "reached" });
				},
				listIntegrations: (_runInput, options) => {
					calls.push({ value: options, fnName: "listIntegrations" });
					return Effect.fail({ message: "reached" });
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(yield* bound.httpCall(["GET", "https://example.com", null])).toEqual({
				success: false,
				error: "reached",
			});
			expect(yield* bound.listIntegrations([null])).toEqual({ success: false, error: "reached" });
			expect(yield* bound.getPluginConfig([[null]])).toEqual({
				success: false,
				error: "0.0: Expected string",
			});
			expect(yield* bound.getSystemConfig([[null]])).toEqual({
				success: false,
				error: "0.0: Expected string",
			});
			expect(calls).toEqual([
				{ value: undefined, fnName: "httpCall" },
				{ value: undefined, fnName: "listIntegrations" },
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
				getSystemConfig: (_runInput, keys) => {
					calls.push({ value: keys, fnName: "getSystemConfig" });
					return Effect.succeed({ timezone: "UTC" });
				},
				getPluginConfig: (_runInput, keys) => {
					calls.push({ value: keys, fnName: "getPluginConfig" });
					return Effect.succeed({ apiToken: "token" });
				},
				claimPersistentValue: (_runInput, key, value, ttlSeconds) => {
					calls.push({ fnName: "claimPersistentValue", value: { key, value, ttlSeconds } });
					return Effect.succeed({ claimed: true as const });
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
				error: "2: Expected an integer",
			});
			expect(yield* bound.setCachedValue(["lock", { owner: "user-1" }, 1.5])).toEqual({
				success: false,
				error: "2: Expected an integer",
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
				{ value: ["apiToken"], fnName: "getPluginConfig" },
				{ value: ["timezone"], fnName: "getSystemConfig" },
			]);
		}),
	);
});
