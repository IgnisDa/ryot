import { describe, expect, test } from "bun:test";

import {
	claimCachedValueResultSchema,
	defineDriver,
	defineManifest,
	defineScript,
	httpCallResultSchema,
	jsonValueSchema,
	logArgsSchema,
	SANDBOX_SCRIPT_DEFINITION,
	spanArgsSchema,
} from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";

const decode = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknownSync(schema);

describe("generic script definitions", () => {
	test("preserves the manifest, schemas, and inferred driver implementation", async () => {
		const manifest = defineManifest({
			kind: "script",
			capabilities: [],
			name: "Increment",
			slug: "increment",
			requiredAppConfigKeys: [],
		});
		const main = defineDriver(manifest, {
			input: Schema.Struct({ value: Schema.Number }),
			output: Schema.Number,
			run: (input) => Effect.succeed(input.value + 1),
		});
		const definition = defineScript({ manifest, drivers: { main } });

		expect(definition.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
		expect(definition.manifest).toBe(manifest);
		expect(
			await Effect.runPromise(
				definition.drivers.main.run(
					{ value: 41 },
					{},
					{ sandboxScriptId: "script-1", metadata: {} },
				),
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
});

describe("sandbox test hosts", () => {
	test("invokes a driver with capability-checked host stubs", async () => {
		const manifest = defineManifest({
			kind: "script",
			name: "Cache reader",
			slug: "cache-reader",
			requiredAppConfigKeys: [],
			capabilities: ["getCachedValue"],
		});
		const main = defineDriver(manifest, {
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
				runSandboxTestDriver(main, { key: "answer" }, host, {
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
		const main = defineDriver(manifest, {
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
					sandboxScriptId: null,
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
				runSandboxTestDriver(main, { entityId: "entity-1" }, host, {
					metadata: {},
					sandboxScriptId: "script-1",
				}),
			),
		).toEqual({ name: "Inception", rows: 2 });
	});
});
