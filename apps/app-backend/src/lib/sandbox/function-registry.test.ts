import { describe, expect, it } from "bun:test";
import { hostFunctionRegistry } from "./function-registry";

describe("hostFunctionRegistry", () => {
	it("registers the expected host function keys", () => {
		expect(Object.keys(hostFunctionRegistry).sort()).toEqual([
			"getAppConfigValue",
			"getEntitySchemas",
			"httpCall",
		]);
	});

	it("returns callable factories for each registered key", () => {
		for (const factory of Object.values(hostFunctionRegistry)) {
			const boundFunction = factory({});
			expect(typeof boundFunction).toBe("function");
		}
	});

	it("returns undefined for an unknown function key", () => {
		expect(
			(hostFunctionRegistry as Record<string, unknown>).missingFunction,
		).toBe(undefined);
	});
});
