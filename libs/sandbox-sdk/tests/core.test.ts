import {
	claimCachedValueResultSchema,
	httpCallResultSchema,
	logArgsSchema,
	spanArgsSchema,
	upsertGlobalEntitiesArgsSchema,
	upsertGlobalRelationshipsArgsSchema,
} from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, test } from "vitest";

import { SANDBOX_SCRIPT_DEFINITION, defineManifest, defineScript } from "../src/driver";
import { jsonValueSchema } from "../src/wire";

const decode = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknownSync(schema);

describe("generic script definitions", () => {
	test("preserves the manifest, schemas, and inferred implementation", async () => {
		const manifest = defineManifest({
			kind: "script",
			capabilities: [],
			name: "Increment",
			slug: "increment",
			requiredAppConfigKeys: [],
		});
		const definition = defineScript({
			manifest,
			input: Schema.Struct({ value: Schema.Number }),
			output: Schema.Number,
			run: (input) => Effect.succeed(input.value + 1),
		});

		expect(definition.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
		expect(definition.manifest).toBe(manifest);
		expect(
			await Effect.runPromise(
				definition.run({ value: 41 }, {}, { sandboxScriptId: "script-1", metadata: {} }),
			),
		).toBe(42);
	});
});

describe("shared value contracts", () => {
	test("accepts nested JSON and discriminates host failures", () => {
		expect(decode(jsonValueSchema)({ nested: [true, 2, null] })).toEqual({
			nested: [true, 2, null],
		});
		expect(() => decode(jsonValueSchema)(Number.NaN)).toThrow();
		expect(() => decode(jsonValueSchema)(Number.POSITIVE_INFINITY)).toThrow();
	});

	test("preserves core host result variants", () => {
		expect(
			decode(httpCallResultSchema)({
				success: false,
				error: "HTTP 429",
				data: { status: 429 },
			}),
		).toEqual({ error: "HTTP 429", data: { status: 429 }, success: false });
		expect(
			decode(claimCachedValueResultSchema)({
				success: true,
				data: { claimed: false, value: { owner: "other" } },
			}),
		).toEqual({ data: { claimed: false, value: { owner: "other" } }, success: true });
	});

	test("accepts valid log and span batches", () => {
		expect(
			decode(logArgsSchema)([
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
		expect(decode(spanArgsSchema)([[{ name: "provider.import" }]])).toEqual([
			[{ name: "provider.import" }],
		]);
	});

	test("rejects malformed or excess log and span entries", () => {
		expect(() => decode(logArgsSchema)([[{ level: "notice", message: "message" }]])).toThrow();
		expect(() => decode(logArgsSchema)([[{ level: "error", message: "" }]])).toThrow();
		expect(() =>
			decode(logArgsSchema)([[{ level: "debug", message: "message", extra: true }]]),
		).toThrow();
		expect(() => decode(spanArgsSchema)([[{ name: "", attributes: {} }]])).toThrow();
		expect(() => decode(spanArgsSchema)([[{ name: "span", extra: true }]])).toThrow();
	});

	test("validates global write batches and reconciliation selectors", () => {
		expect(
			decode(upsertGlobalEntitiesArgsSchema)([
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
		expect(() => decode(upsertGlobalEntitiesArgsSchema)([[], { maximumTotal: -1 }])).toThrow();
		expect(() => decode(upsertGlobalEntitiesArgsSchema)([[], { maximumTotal: 1.5 }])).toThrow();
		expect(
			decode(upsertGlobalRelationshipsArgsSchema)([
				[
					{
						relationshipSchemaSlug: "acted-in",
						selector: { type: "anchored", direction: "outgoing", anchorEntityId: "person-1" },
						relationships: [
							{ properties: { order: 1 }, sourceEntityId: "person-1", targetEntityId: "movie-1" },
						],
					},
				],
			]),
		).toHaveLength(1);
		expect(() =>
			decode(upsertGlobalRelationshipsArgsSchema)([
				[{ relationships: [], selector: { type: "all" }, relationshipSchemaSlug: "acted-in" }],
			]),
		).toThrow();
	});
});

describe("sandbox test hosts", () => {
	test("invokes a script with capability-checked host stubs", async () => {
		const manifest = defineManifest({
			kind: "script",
			name: "Cache reader",
			slug: "cache-reader",
			requiredAppConfigKeys: [],
			capabilities: ["getCachedValue"],
		});
		const definition = defineScript({
			manifest,
			input: Schema.Struct({ key: Schema.String }),
			output: Schema.NullOr(Schema.Number),
			run: (input, host) =>
				host
					.getCachedValue(input.key)
					.pipe(Effect.map((value) => (typeof value === "number" ? value : null))),
		});
		const host = defineSandboxTestHost(manifest, {
			getCachedValue: () => Effect.succeed(42),
		});

		expect(
			await Effect.runPromise(
				runSandboxTestScript(definition, { key: "answer" }, host, {
					metadata: {},
					sandboxScriptId: "script-1",
				}),
			),
		).toBe(42);
	});
});

describe("domain host contracts", () => {
	test("invokes domain host stubs and keeps query-engine output unparsed", async () => {
		const manifest = defineManifest({
			kind: "script",
			name: "Domain reader",
			slug: "domain-reader",
			requiredAppConfigKeys: [],
			capabilities: ["getEntity", "executeQueryEngine"],
		});
		const definition = defineScript({
			manifest,
			input: Schema.Struct({ entityId: Schema.String }),
			output: Schema.Struct({ name: Schema.String, rows: Schema.Number }),
			run: (input, host) =>
				Effect.all({
					entity: host.getEntity(input.entityId),
					result: host.executeQueryEngine({ source: { type: "entities" } }),
				}).pipe(
					Effect.map(({ entity, result }) => ({
						name: entity.name,
						rows: Array.isArray(result) ? result.length : 0,
					})),
				),
		});
		const host = defineSandboxTestHost(manifest, {
			getEntity: (entityId) =>
				Effect.succeed({
					id: entityId,
					name: "Inception",
					populatedAt: null,
					providerId: null,
					externalId: "tt1375666",
					entitySchemaSlug: "movie",
					properties: { runtime: 148 },
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
				}),
			executeQueryEngine: () => Effect.succeed([{ id: "a" }, { id: "b" }]),
		});

		expect(
			await Effect.runPromise(
				runSandboxTestScript(definition, { entityId: "entity-1" }, host, {
					metadata: {},
					sandboxScriptId: "script-1",
				}),
			),
		).toEqual({ name: "Inception", rows: 2 });
	});
});
