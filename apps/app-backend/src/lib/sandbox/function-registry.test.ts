import { describe, expect, it } from "bun:test";
import { apiSuccess } from "~/lib/sandbox/types";
import { hostFunctionRegistry } from "./function-registry";

describe("hostFunctionRegistry", () => {
	it("registers the expected host function keys", () => {
		expect(Object.keys(hostFunctionRegistry).sort()).toEqual([
			"getAppConfigValue",
			"getEntitySchemas",
			"getUserConfigValue",
			"httpCall",
		]);
	});

	it("returns callable factories for each registered key", () => {
		for (const factory of Object.values(hostFunctionRegistry)) {
			const boundFunction = factory({});
			expect(typeof boundFunction).toBe("function");
		}
	});

	it("returns a bound function that does not require context from the caller", async () => {
		const boundFunction = hostFunctionRegistry.getUserConfigValue({});

		expect(boundFunction("pageSize")).resolves.toEqual(apiSuccess(20));
	});

	it("returns undefined for an unknown function key", () => {
		expect(
			(hostFunctionRegistry as Record<string, unknown>).missingFunction,
		).toBe(undefined);
	});
});
