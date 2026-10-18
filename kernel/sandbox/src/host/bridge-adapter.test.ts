import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { bindObservabilityHostFunctions, bindSandboxHostFunctions } from "./bridge-adapter";
import type { SandboxHostImplementationMap } from "./invocation";
import { makeUserRunInput } from "./run-input.test-support";

const input = makeUserRunInput();

const managedAssetFailure = (key: string | undefined) => {
	if (key === "private") {
		return { code: "asset-forbidden", privateMetadata: "secret" };
	}
	if (key === "boundary") {
		return { code: "unavailable-operation", operation: "verifyManagedAssets" };
	}
	if (key === "unknown") {
		return { code: "private-error", privateMetadata: "secret" };
	}
	return { code: "asset-forbidden" };
};

const makeImplementations = (
	overrides: Partial<SandboxHostImplementationMap> = {},
): SandboxHostImplementationMap => ({
	log: () => Effect.fail({ message: "unused" }),
	span: () => Effect.fail({ message: "unused" }),
	httpCall: () => Effect.fail({ message: "unused" }),
	emitSignal: () => Effect.fail({ message: "unused" }),
	createEvents: () => Effect.fail({ message: "unused" }),
	updateEvents: () => Effect.fail({ message: "unused" }),
	deleteEvents: () => Effect.fail({ message: "unused" }),
	executeRyotql: () => Effect.fail({ message: "unused" }),
	getCachedValue: () => Effect.fail({ message: "unused" }),
	setCachedValue: () => Effect.fail({ message: "unused" }),
	getPluginConfig: () => Effect.fail({ message: "unused" }),
	getUserSettings: () => Effect.fail({ message: "unused" }),
	requestUserWork: () => Effect.fail({ message: "unused" }),
	getEntitySchemas: () => Effect.fail({ message: "unused" }),
	listEventSchemas: () => Effect.fail({ message: "unused" }),
	listIntegrations: () => Effect.fail({ message: "unused" }),
	sendNotification: () => Effect.fail({ message: "unused" }),
	createUserEntity: () => Effect.fail({ message: "unused" }),
	deleteUserEntity: () => Effect.fail({ message: "unused" }),
	updateUserEntity: () => Effect.fail({ message: "unused" }),
	commitUserChanges: () => Effect.fail({ message: "unused" }),
	updateUserSettings: () => Effect.fail({ message: "unused" }),
	getPersistentValue: () => Effect.fail({ message: "unused" }),
	getUserPreferences: () => Effect.fail({ message: "unused" }),
	getProAvailability: () => Effect.fail({ message: "unused" }),
	ensureUserEntities: () => Effect.fail({ message: "unused" }),
	mergeUserEntityData: () => Effect.fail({ message: "unused" }),
	clearUserEntityData: () => Effect.fail({ message: "unused" }),
	verifyManagedAssets: () => Effect.fail({ message: "unused" }),
	getOAuthAccessToken: () => Effect.fail({ message: "unused" }),
	claimPersistentValue: () => Effect.fail({ message: "unused" }),
	upsertGlobalEntities: () => Effect.fail({ message: "unused" }),
	getCurrentIntegration: () => Effect.fail({ message: "unused" }),
	requestEventStreamWork: () => Effect.fail({ message: "unused" }),
	changeUserRelationships: () => Effect.fail({ message: "unused" }),
	upsertGlobalRelationships: () => Effect.fail({ message: "unused" }),
	invalidateOAuthAccessToken: () => Effect.fail({ message: "unused" }),
	...overrides,
});

describe("bindSandboxHostFunctions", () => {
	it.effect("keeps the bound bridge in Effect", () =>
		Effect.gen(function* () {
			const result = bindSandboxHostFunctions(makeImplementations(), input).getCachedValue(["key"]);
			expect(yield* result).toEqual({ success: false, error: "unused" });
		}),
	);

	it.effect("preserves boundary reason data in the normal host failure result", () =>
		Effect.gen(function* () {
			const bound = bindSandboxHostFunctions(
				makeImplementations({
					getPluginConfig: () =>
						Effect.fail({
							message: "A required plugin config value is not configured",
							data: { keys: ["apiToken"], code: "missing-required-config" },
						}),
				}),
				input,
			);
			const result = yield* bound.getPluginConfig([{ required: ["apiToken"] }]);

			expect(result).toMatchObject({
				success: false,
				error: expect.stringContaining("not configured"),
				data: { keys: ["apiToken"], code: "missing-required-config" },
			});
		}),
	);

	it.effect("preserves an asset-forbidden signal rejection for the guest", () =>
		Effect.gen(function* () {
			const bound = bindSandboxHostFunctions(
				makeImplementations({
					emitSignal: () =>
						Effect.fail({
							data: { code: "asset-forbidden" },
							message: "Signal properties reference a forbidden managed asset",
						}),
				}),
				input,
			);
			expect(
				yield* bound.emitSignal([
					{ properties: {}, discriminator: "review-1", schemaSlug: "review.created" },
				]),
			).toEqual({
				success: false,
				data: { code: "asset-forbidden" },
				error: "Signal properties reference a forbidden managed asset",
			});
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

	it.effect("binds Pro availability and bounded managed asset verification without a user id", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				getProAvailability: (runInput) => {
					calls.push({ runInput, operation: "getProAvailability" });
					return Effect.succeed(true);
				},
				verifyManagedAssets: (runInput, locators) => {
					calls.push({ locators, runInput, operation: "verifyManagedAssets" });
					return Effect.succeed(null);
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const locators = Array.from({ length: 500 }, (_, index) => ({
				type: "local" as const,
				key: `managed/${index}`,
			}));

			expect(yield* bound.getProAvailability([])).toEqual({ data: true, success: true });
			expect(yield* bound.verifyManagedAssets([locators])).toEqual({ data: null, success: true });
			expect(yield* bound.verifyManagedAssets([locators, "caller-selected-user"])).toEqual({
				success: false,
				error: "verifyManagedAssets received an invalid number of arguments",
			});
			expect(
				yield* bound.verifyManagedAssets([
					Array.from({ length: 501 }, (_, index) => ({
						type: "s3" as const,
						key: `managed/${index}`,
					})),
				]),
			).toMatchObject({ success: false });
			expect(calls).toEqual([
				{ runInput: input, operation: "getProAvailability" },
				{ locators, runInput: input, operation: "verifyManagedAssets" },
			]);
		}),
	);

	it.effect("preserves only allowlisted managed asset failure data", () =>
		Effect.gen(function* () {
			const implementations = makeImplementations({
				verifyManagedAssets: (_runInput, locators) =>
					Effect.fail({
						message: "Asset verification failed",
						data: managedAssetFailure(locators[0]?.key),
					}),
			});
			const bound = bindSandboxHostFunctions(implementations, input);

			expect(yield* bound.verifyManagedAssets([[{ type: "local", key: "forbidden" }]])).toEqual({
				success: false,
				data: { code: "asset-forbidden" },
				error: "Asset verification failed",
			});
			expect(yield* bound.verifyManagedAssets([[{ type: "local", key: "private" }]])).toEqual({
				success: false,
				data: { code: "asset-forbidden" },
				error: "Asset verification failed",
			});
			expect(yield* bound.verifyManagedAssets([[{ type: "local", key: "unknown" }]])).toEqual({
				success: false,
				error: "Asset verification failed",
			});
			expect(yield* bound.verifyManagedAssets([[{ type: "local", key: "boundary" }]])).toEqual({
				success: false,
				error: "Asset verification failed",
				data: { code: "unavailable-operation", operation: "verifyManagedAssets" },
			});
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

	it.effect("binds read-only user settings with no arguments", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const bound = bindSandboxHostFunctions(
				makeImplementations({
					getUserSettings: (runInput) => {
						calls.push(runInput);
						return Effect.succeed({ allowNsfw: true });
					},
				}),
				input,
			);

			expect(yield* bound.getUserSettings([])).toEqual({
				success: true,
				data: { allowNsfw: true },
			});
			expect(yield* bound.getUserSettings(["extra"])).toEqual({
				success: false,
				error: "getUserSettings received an invalid number of arguments",
			});
			expect(calls).toEqual([input]);
		}),
	);

	it.effect("binds a user settings patch to the run input and acknowledges it", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const bound = bindSandboxHostFunctions(
				makeImplementations({
					updateUserSettings: (runInput, patch) => {
						calls.push({ patch, runInput });
						return Effect.succeed({ saved: true as const });
					},
				}),
				input,
			);

			expect(yield* bound.updateUserSettings([{ allowNsfw: true }])).toEqual({
				success: true,
				data: { saved: true },
			});
			expect(yield* bound.updateUserSettings([])).toEqual({
				success: false,
				error: "updateUserSettings received an invalid number of arguments",
			});
			expect(yield* bound.updateUserSettings(["allowNsfw"])).toMatchObject({ success: false });
			expect(calls).toEqual([{ runInput: input, patch: { allowNsfw: true } }]);
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
			const bound = bindObservabilityHostFunctions(implementations, input);

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
						propertiesMode: "replace",
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

	it.effect("validates single user entity creates without accepting a caller-owned subject", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const implementations = makeImplementations({
				createUserEntity: (runInput, item) => {
					calls.push({ item, runInput });
					return Effect.succeed({ entityId: "created-id" });
				},
			});
			const bound = bindSandboxHostFunctions(implementations, input);
			const item = {
				name: "Library",
				properties: { color: "blue" },
				entitySchemaSlug: "media-library",
			};

			expect(yield* bound.createUserEntity([item])).toEqual({
				success: true,
				data: { entityId: "created-id" },
			});
			expect(calls).toEqual([{ item, runInput: input }]);
			expect(yield* bound.createUserEntity([{ ...item, userId: "caller-selected" }])).toEqual({
				success: false,
				error: "0.userId: Expected no excess property",
			});
			expect(yield* bound.createUserEntity([{ ...item, scope: "caller-selected" }])).toEqual({
				success: false,
				error: "0.scope: Expected no excess property",
			});
			expect(calls).toHaveLength(1);
		}),
	);

	it.effect("validates user entity deletions and forwards submission options", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const bound = bindSandboxHostFunctions(
				makeImplementations({
					deleteUserEntity: (runInput, item, options) => {
						calls.push({ item, options, runInput });
						return Effect.succeed({ entityId: item.entityId });
					},
				}),
				input,
			);
			const item = { entityId: "entity", entitySchemaSlug: "media-library" };
			const options = { idempotencyKey: "submission", submittedAt: "2026-10-15T00:00:00Z" };
			expect(yield* bound.deleteUserEntity([item, options])).toEqual({
				success: true,
				data: { entityId: "entity" },
			});
			expect(calls).toEqual([{ item, options, runInput: input }]);
			expect(yield* bound.deleteUserEntity([{ ...item, userId: "other" }, options])).toEqual({
				success: false,
				error: "0.userId: Expected no excess property",
			});
			expect(calls).toHaveLength(1);
		}),
	);

	it.effect("preserves user-data conflicts for operation refusal handling", () =>
		Effect.gen(function* () {
			const state = { code: "state-conflict", message: "Refresh and retry" };
			const mapping = {
				entityIds: ["child"],
				code: "child-mapping-conflict",
				message: "Match the child first",
			};
			const bound = bindSandboxHostFunctions(
				makeImplementations({
					clearUserEntityData: () => Effect.fail({ data: state, message: "state-conflict" }),
					mergeUserEntityData: () =>
						Effect.fail({ data: mapping, message: "child-mapping-conflict" }),
				}),
				input,
			);
			expect(
				yield* bound.clearUserEntityData([{ entityId: "entity", entitySchemaSlug: "record" }]),
			).toEqual({ data: state, success: false, error: "state-conflict" });
			expect(
				yield* bound.mergeUserEntityData([
					{ mergeFrom: "source", mergeInto: "target", entitySchemaSlug: "record" },
				]),
			).toEqual({ data: mapping, success: false, error: "child-mapping-conflict" });
		}),
	);

	it.effect("preserves typed write conflicts and rejects caller-selected update authority", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const bound = bindSandboxHostFunctions(
				makeImplementations({
					updateUserEntity: (runInput, item, options) => {
						calls.push({ item, options, runInput });
						return Effect.fail({
							message: "changed",
							data: { message: "changed", code: "mutation-conflict" },
						});
					},
				}),
				input,
			);
			const item = {
				properties: {},
				name: "Changed",
				entityId: "entity",
				expected: { properties: {}, name: "Original", updatedAt: "2026-10-15T00:00:00Z" },
			};
			const options = { idempotencyKey: "submission", submittedAt: "2026-10-15T00:00:00Z" };
			expect(yield* bound.updateUserEntity([item, options])).toEqual({
				success: false,
				error: "changed",
				data: { message: "changed", code: "mutation-conflict" },
			});
			expect(calls).toEqual([{ item, options, runInput: input }]);
			expect(yield* bound.updateUserEntity([{ ...item, userId: "other" }, options])).toEqual({
				success: false,
				error: "0.userId: Expected no excess property",
			});
			expect(calls).toHaveLength(1);
		}),
	);

	it.effect(
		"preserves typed entity staleness and drops write failure data outside the allowlist",
		() =>
			Effect.gen(function* () {
				const failures = [
					{ entityId: "entity", code: "entity-stale" },
					{ name: "Original", entityId: "entity", code: "entity-stale" },
					{ privateMetadata: "secret", code: "global-scope-forbidden" },
					{ message: "forbidden", code: "global-scope-forbidden" },
				];
				const bound = bindSandboxHostFunctions(
					makeImplementations({
						updateUserEntity: () => {
							const data = failures.shift();
							return Effect.fail({ data, message: "failed" });
						},
					}),
					input,
				);
				const item = {
					properties: {},
					name: "Changed",
					entityId: "entity",
					expected: { properties: {}, name: "Original", updatedAt: "2026-10-15T00:00:00Z" },
				};
				expect(yield* bound.updateUserEntity([item])).toEqual({
					success: false,
					error: "failed",
					data: { entityId: "entity", code: "entity-stale" },
				});
				expect(yield* bound.updateUserEntity([item])).toEqual({ success: false, error: "failed" });
				expect(yield* bound.updateUserEntity([item])).toEqual({
					success: false,
					error: "failed",
					data: { code: "global-scope-forbidden" },
				});
				expect(yield* bound.updateUserEntity([item])).toEqual({
					success: false,
					error: "failed",
					data: { message: "forbidden", code: "global-scope-forbidden" },
				});
			}),
	);

	it.effect(
		"dispatches domain calls with the server-provided run input and rejects surplus arguments",
		() =>
			Effect.gen(function* () {
				let calls = 0;
				let receivedUserId: null | string = "unset";
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
			expect(yield* bound.getPluginConfig([{ required: [null] }])).toEqual({
				success: false,
				error: "0.required.0: Expected string",
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
			expect(yield* bound.getPluginConfig([{ required: ["apiToken"] }])).toEqual({
				success: true,
				data: { apiToken: "token" },
			});
			expect(yield* bound.claimPersistentValue(["lock", { owner: "user-1" }, 1.5])).toEqual({
				success: false,
				error: "2: Expected an integer",
			});
			expect(yield* bound.setCachedValue(["lock", { owner: "user-1" }, 1.5])).toEqual({
				success: false,
				error: "2: Expected an integer",
			});
			expect(yield* bound.getPluginConfig([{ required: ["apiToken"] }, "surplus"])).toEqual({
				success: false,
				error: "getPluginConfig received an invalid number of arguments",
			});
			expect(calls).toEqual([
				{
					fnName: "claimPersistentValue",
					value: { key: "lock", ttlSeconds: 60, value: { owner: "user-1" } },
				},
				{ fnName: "getPluginConfig", value: { required: ["apiToken"] } },
			]);
		}),
	);
});
