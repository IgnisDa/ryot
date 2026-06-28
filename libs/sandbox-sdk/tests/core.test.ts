import { describe, expect, test } from "bun:test";

import {
	claimCachedValueResultSchema,
	defineDriver,
	defineManifest,
	defineScript,
	hostResultSchema,
	httpCallResultSchema,
	jsonValueSchema,
	SANDBOX_SCRIPT_DEFINITION,
	unwrapHostResult,
	z,
} from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";

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
			input: z.object({ value: z.number() }),
			output: z.number(),
			run: (input) => Promise.resolve(input.value + 1),
		});
		const definition = defineScript({ manifest, drivers: { main } });

		expect(definition.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
		expect(definition.manifest).toBe(manifest);
		expect(
			await definition.drivers.main.run(
				{ value: 41 },
				{},
				{ sandboxScriptId: "script-1", metadata: {} },
			),
		).toBe(42);
	});
});

describe("shared value contracts", () => {
	test("accepts nested JSON and discriminates host failures", () => {
		expect(jsonValueSchema.parse({ nested: [true, 2, null] })).toEqual({
			nested: [true, 2, null],
		});
		expect(hostResultSchema(z.number()).parse({ success: false, error: "unavailable" })).toEqual({
			success: false,
			error: "unavailable",
		});
	});

	test("preserves core host result variants and unwraps success data", () => {
		expect(
			httpCallResultSchema.parse({
				success: false,
				error: "HTTP 429",
				data: { status: 429 },
			}),
		).toEqual({ error: "HTTP 429", data: { status: 429 }, success: false });
		expect(
			claimCachedValueResultSchema.parse({
				success: true,
				data: { claimed: false, value: { owner: "other" } },
			}),
		).toEqual({ data: { claimed: false, value: { owner: "other" } }, success: true });
		expect(unwrapHostResult({ data: 42, success: true })).toBe(42);
		expect(() => unwrapHostResult({ error: "unavailable", success: false })).toThrow("unavailable");
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
			input: z.object({ key: z.string() }),
			output: z.number().nullable(),
			run: async (input, host) => {
				const result = await host.getCachedValue(input.key);
				return result.success && typeof result.data === "number" ? result.data : null;
			},
		});
		const host = defineSandboxTestHost(manifest, {
			getCachedValue: () => Promise.resolve({ data: 42, success: true }),
		});

		expect(
			await runSandboxTestDriver(main, { key: "answer" }, host, {
				metadata: {},
				sandboxScriptId: "script-1",
			}),
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
			input: z.object({ entityId: z.string() }),
			output: z.object({ name: z.string(), rows: z.number() }),
			run: async (input, host) => {
				const entity = unwrapHostResult(await host.getEntity(input.entityId));
				const result = unwrapHostResult(
					await host.executeQueryEngine({ source: { type: "entities" } }),
				);
				return { name: entity.name, rows: Array.isArray(result) ? result.length : 0 };
			},
		});
		const host = defineSandboxTestHost(manifest, {
			getEntity: (entityId) =>
				Promise.resolve({
					success: true,
					data: {
						id: entityId,
						name: "Inception",
						populatedAt: null,
						sandboxScriptId: null,
						externalId: "tt1375666",
						entitySchemaId: "movie",
						properties: { runtime: 148 },
						createdAt: "2024-01-01T00:00:00.000Z",
						updatedAt: "2024-01-01T00:00:00.000Z",
					},
				}),
			executeQueryEngine: () =>
				Promise.resolve({ success: true, data: [{ id: "a" }, { id: "b" }] }),
		});

		expect(
			await runSandboxTestDriver(main, { entityId: "entity-1" }, host, {
				metadata: {},
				sandboxScriptId: "script-1",
			}),
		).toEqual({ name: "Inception", rows: 2 });
	});
});
