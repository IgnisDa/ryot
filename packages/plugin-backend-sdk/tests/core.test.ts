import { describe, expect, it, test } from "@effect/vitest";
import {
	changeUserRelationshipsArgsSchema,
	claimPersistentValueResultSchema,
	clearUserEntityDataArgsSchema,
	clearUserEntityDataResultSchema,
	deleteEventsArgsSchema,
	ensureUserEntitiesArgsSchema,
	httpCallArgsSchema,
	httpCallResultSchema,
	logArgsSchema,
	recoverPartialCreateEvents,
	spanArgsSchema,
	updateEventsArgsSchema,
	updateUserSettingsResultSchema,
	upsertGlobalEntitiesArgsSchema,
	upsertGlobalRelationshipsArgsSchema,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { defineManifest, defineScript, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";
import { asRecord, jsonValueSchema } from "../src/wire";

describe("generic script definitions", () => {
	test("preserves the manifest, schemas, and inferred implementation", () => {
		const manifest = defineManifest({ kind: "script", name: "Increment", slug: "increment" });
		const definition = defineScript({
			manifest,
			output: Schema.Finite,
			input: Schema.Struct({ value: Schema.Finite }),
			run: (input) => Effect.succeed(input.value + 1),
		});

		expect(definition.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
		expect(definition.manifest).toBe(manifest);
		expect(
			Effect.runSync(
				definition.run({ value: 41 }, {}, { metadata: {}, sandboxScriptId: "script-1" }),
			),
		).toBe(42);
	});
});

describe("shared value contracts", () => {
	it.effect("accepts nested JSON and discriminates host failures", () =>
		Effect.gen(function* () {
			expect(yield* Schema.decodeEffect(jsonValueSchema)({ nested: [true, 2, null] })).toEqual({
				nested: [true, 2, null],
			});
			yield* Effect.flip(Schema.decodeEffect(jsonValueSchema)(Number.NaN));
			yield* Effect.flip(Schema.decodeEffect(jsonValueSchema)(Number.POSITIVE_INFINITY));
			const cyclic: Record<string, unknown> = {};
			cyclic["self"] = cyclic;
			yield* Effect.flip(Schema.decodeUnknownEffect(jsonValueSchema)(cyclic));
			yield* Effect.flip(Schema.decodeEffect(jsonValueSchema)(Array(1)));
		}),
	);

	it.effect("preserves core host result variants", () =>
		Effect.gen(function* () {
			expect(
				yield* Schema.decodeEffect(httpCallArgsSchema)([
					"GET",
					"https://example.com",
					{ allowInsecureConnections: true },
				]),
			).toEqual(["GET", "https://example.com", { allowInsecureConnections: true }]);
			expect(
				yield* Schema.decodeEffect(httpCallResultSchema)({
					success: false,
					error: "HTTP 429",
					data: { status: 429, body: "rate limited", headers: { "retry-after": "10" } },
				}),
			).toEqual({
				success: false,
				error: "HTTP 429",
				data: { status: 429, body: "rate limited", headers: { "retry-after": "10" } },
			});
			expect(
				yield* Schema.decodeEffect(claimPersistentValueResultSchema)({
					success: true,
					data: { claimed: false, value: { owner: "other" } },
				}),
			).toEqual({ success: true, data: { claimed: false, value: { owner: "other" } } });
		}),
	);

	it.effect("validates user entity data clearing requests and counts", () =>
		Effect.gen(function* () {
			const args = [
				{ entityId: "entity-1", entitySchemaSlug: "workspace" },
				{ idempotencyKey: "clear-1", submittedAt: "2026-01-02T00:00:00.000Z" },
			] as const;
			expect(yield* Schema.decodeEffect(clearUserEntityDataArgsSchema)(args)).toEqual(args);
			yield* Effect.flip(
				Schema.decodeEffect(clearUserEntityDataArgsSchema)([
					{ entityId: "entity-1", entitySchemaSlug: "" },
				]),
			);
			const result = {
				success: true,
				data: { deletedEventsCount: 2, deletedRelationshipsCount: 3 },
			} as const;
			expect(yield* Schema.decodeEffect(clearUserEntityDataResultSchema)(result)).toEqual(result);
			for (const count of [-1, 1.5]) {
				yield* Effect.flip(
					Schema.decodeEffect(clearUserEntityDataResultSchema)({
						success: true,
						data: { deletedEventsCount: count, deletedRelationshipsCount: 0 },
					}),
				);
			}
		}),
	);

	it.effect("acknowledges user settings updates without returning settings", () =>
		Effect.gen(function* () {
			expect(
				yield* Schema.decodeEffect(updateUserSettingsResultSchema)({
					success: true,
					data: { saved: true },
				}),
			).toEqual({ success: true, data: { saved: true } });
			yield* Effect.flip(
				Schema.decodeUnknownEffect(updateUserSettingsResultSchema)({
					success: true,
					data: { limit: 3 },
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(updateUserSettingsResultSchema)({
					success: true,
					data: { saved: true, settings: { limit: 3 } },
				}),
			);
		}),
	);

	it.effect("accepts valid log and span batches", () =>
		Effect.gen(function* () {
			expect(
				yield* Schema.decodeEffect(logArgsSchema)([
					[
						{
							level: "info",
							message: "Imported entities",
							attributes: { count: 2, context: { source: "provider" } },
						},
					],
				]),
			).toEqual([
				[
					{
						level: "info",
						message: "Imported entities",
						attributes: { count: 2, context: { source: "provider" } },
					},
				],
			]);
			expect(yield* Schema.decodeEffect(spanArgsSchema)([[{ name: "provider.import" }]])).toEqual([
				[{ name: "provider.import" }],
			]);
		}),
	);

	it.effect("rejects malformed or excess log and span entries", () =>
		Effect.gen(function* () {
			yield* Effect.flip(
				Schema.decodeUnknownEffect(logArgsSchema)([[{ level: "notice", message: "message" }]]),
			);
			yield* Effect.flip(Schema.decodeEffect(logArgsSchema)([[{ message: "", level: "error" }]]));
			yield* Effect.flip(
				Schema.decodeUnknownEffect(logArgsSchema)([
					[{ extra: true, level: "debug", message: "message" }],
				]),
			);
			yield* Effect.flip(Schema.decodeEffect(spanArgsSchema)([[{ name: "", attributes: {} }]]));
			yield* Effect.flip(
				Schema.decodeUnknownEffect(spanArgsSchema)([[{ extra: true, name: "span" }]]),
			);
		}),
	);

	it.effect("validates global write batches and reconciliation selectors", () =>
		Effect.gen(function* () {
			expect(
				yield* Schema.decodeEffect(upsertGlobalEntitiesArgsSchema)([
					[
						{
							name: "Cooper",
							populatedAt: null,
							externalId: "person-1",
							entitySchemaSlug: "person",
							properties: { role: "actor" },
						},
					],
					{ maximumTotal: 100 },
				]),
			).toHaveLength(2);
			yield* Effect.flip(
				Schema.decodeEffect(upsertGlobalEntitiesArgsSchema)([[], { maximumTotal: -1 }]),
			);
			yield* Effect.flip(
				Schema.decodeEffect(upsertGlobalEntitiesArgsSchema)([[], { maximumTotal: 1.5 }]),
			);
			expect(
				yield* Schema.decodeEffect(upsertGlobalRelationshipsArgsSchema)([
					[
						{
							relationshipSchemaSlug: "acted-in",
							selector: { type: "anchored", direction: "outgoing", anchorEntityId: "person-1" },
							relationships: [
								{ properties: { order: 1 }, targetEntityId: "entry-1", sourceEntityId: "person-1" },
							],
						},
					],
				]),
			).toHaveLength(1);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(upsertGlobalRelationshipsArgsSchema)([
					[{ relationships: [], selector: { type: "all" }, relationshipSchemaSlug: "acted-in" }],
				]),
			);
		}),
	);

	it.effect("validates generic user relationship change batches", () =>
		Effect.gen(function* () {
			const identity = {
				sourceEntityId: "entity-1",
				targetEntityId: "collection-1",
				relationshipSchemaSlug: "member-of",
			};
			expect(
				yield* Schema.decodeEffect(changeUserRelationshipsArgsSchema)([
					[{ deletes: [], creates: [{ ...identity, properties: {}, propertiesMode: "replace" }] }],
				]),
			).toHaveLength(1);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(changeUserRelationshipsArgsSchema)([
					[{ deletes: [], creates: [{ ...identity, properties: {} }] }],
				]),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(changeUserRelationshipsArgsSchema)([
					[{ creates: [], deletes: [], userId: "caller-selected" }],
				]),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(changeUserRelationshipsArgsSchema)([
					[
						{
							deletes: Array.from({ length: 50 }, () => identity),
							creates: Array.from({ length: 51 }, () => ({
								...identity,
								properties: {},
								propertiesMode: "replace",
							})),
						},
					],
				]),
			);
		}),
	);

	it.effect("validates bounded event mutation batches and property patches", () =>
		Effect.gen(function* () {
			const update = {
				eventId: "event-1",
				patch: { properties: { remove: ["old"], set: { rating: 5 } } },
			};
			expect(yield* Schema.decodeEffect(updateEventsArgsSchema)([[update]])).toEqual([[update]]);
			expect(yield* Schema.decodeEffect(deleteEventsArgsSchema)([["event-1"]])).toEqual([
				["event-1"],
			]);
			yield* Effect.flip(
				Schema.decodeEffect(updateEventsArgsSchema)([Array.from({ length: 101 }, () => update)]),
			);
			yield* Effect.flip(
				Schema.decodeEffect(deleteEventsArgsSchema)([
					Array.from({ length: 101 }, (_, index) => `event-${index}`),
				]),
			);
			yield* Effect.flip(
				Schema.decodeEffect(updateEventsArgsSchema)([
					[{ ...update, patch: { properties: { remove: ["rating"], set: { rating: 5 } } } }],
				]),
			);
			yield* Schema.decodeEffect(updateEventsArgsSchema)([
				[{ ...update, patch: { entityId: "entity-1" } }],
			]);
		}),
	);

	it.effect("validates user entity ensure batches without accepting caller-owned subject", () =>
		Effect.gen(function* () {
			const item = { properties: {}, name: "Library", entitySchemaSlug: "fixture-library" };
			expect(yield* Schema.decodeEffect(ensureUserEntitiesArgsSchema)([[item]])).toEqual([[item]]);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(ensureUserEntitiesArgsSchema)([
					[{ ...item, userId: "caller-selected" }],
				]),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(ensureUserEntitiesArgsSchema)([
					[{ ...item, pluginId: "caller-selected" }],
				]),
			);
			yield* Effect.flip(
				Schema.decodeEffect(ensureUserEntitiesArgsSchema)([
					Array.from({ length: 501 }, () => item),
				]),
			);
		}),
	);
});

describe("sandbox test hosts", () => {
	test("invokes a script with partial host stubs", () => {
		const manifest = defineManifest({ kind: "script", name: "Cache reader", slug: "cache-reader" });
		const definition = defineScript({
			manifest,
			output: Schema.NullOr(Schema.Finite),
			input: Schema.Struct({ key: Schema.String }),
			run: (input, host) =>
				host
					.getCachedValue(input.key)
					.pipe(Effect.map((value) => (typeof value === "number" ? value : null))),
		});
		const host = defineSandboxTestHost(manifest, { getCachedValue: () => Effect.succeed(42) });

		return Effect.runPromise(
			runSandboxTestScript(definition, { key: "answer" }, host, {
				metadata: {},
				sandboxScriptId: "script-1",
			}).pipe(Effect.map((value) => expect(value).toBe(42))),
		);
	});
});

describe("domain host contracts", () => {
	test("invokes domain host stubs and keeps RyotQL output unparsed", () => {
		const manifest = defineManifest({
			kind: "script",
			name: "Domain reader",
			slug: "domain-reader",
		});
		const definition = defineScript({
			manifest,
			input: Schema.Struct({}),
			output: Schema.Struct({ rows: Schema.Finite }),
			run: (_input, host) =>
				host
					.executeRyotql({ queries: {} })
					.pipe(Effect.map((result) => ({ rows: Array.isArray(result) ? result.length : 0 }))),
		});
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => Effect.succeed([{ id: "a" }, { id: "b" }]),
		});

		return Effect.runPromise(
			runSandboxTestScript(definition, {}, host, {
				metadata: {},
				sandboxScriptId: "script-1",
			}).pipe(Effect.map((value) => expect(value).toEqual({ rows: 2 }))),
		);
	});
});

describe("recoverPartialCreateEvents", () => {
	const outcomes = [{ index: 0, status: "written", eventId: "event-1" }];

	test("recovers the written count from a partial createEvents failure", () =>
		Effect.runPromise(
			recoverPartialCreateEvents({
				message: "validation failed",
				data: { outcomes, count: 1, partial: true, code: "validation-failed" },
			}).pipe(Effect.map((recovered) => expect(recovered).toEqual({ count: 1 }))),
		));

	test("re-fails a non-partial failure unchanged", () => {
		const error = {
			message: "conflict",
			data: { outcomes, count: 1, partial: false, code: "mutation-conflict" },
		};
		return Effect.runPromise(
			recoverPartialCreateEvents(error).pipe(
				Effect.flip,
				Effect.map((failure) => expect(failure).toBe(error)),
			),
		);
	});

	test("re-fails a failure without data", () => {
		const error = { message: "boom" };
		return Effect.runPromise(
			recoverPartialCreateEvents(error).pipe(
				Effect.flip,
				Effect.map((failure) => expect(failure).toBe(error)),
			),
		);
	});
});

describe("asRecord", () => {
	test("returns plain objects unchanged", () => {
		const value = { a: 1 };
		expect(asRecord(value)).toBe(value);
	});

	test.each([null, undefined, [], [1], "text", 3, true])("rejects %j", (value) => {
		expect(asRecord(value)).toBeNull();
	});
});
