import { describe, expect, test } from "bun:test";

import {
	defineDriver,
	defineManifest,
	defineScript,
	hostResultSchema,
	jsonValueSchema,
	SANDBOX_SCRIPT_DEFINITION,
	z,
} from "@ryot/sandbox-sdk";

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
});
