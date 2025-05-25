import { describe, expect, it } from "bun:test";
import { hostFunctionRegistry } from "./function-registry";

describe("hostFunctionRegistry", () => {
	it("registers the expected host function keys", () => {
		expect(Object.keys(hostFunctionRegistry).sort()).toEqual([
			"executeQuery",
			"getAppConfigValue",
			"getUserPreferences",
			"httpCall",
		]);
	});
});
