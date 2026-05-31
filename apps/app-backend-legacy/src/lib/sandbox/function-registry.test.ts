import { describe, expect, it } from "bun:test";

import { buildApiFunctionDescriptors, hostFunctionRegistry } from "./function-registry";
import { apiFailure } from "./types";

describe("buildApiFunctionDescriptors", () => {
	it("returns an empty array for an empty allowedKeys list", () => {
		expect(buildApiFunctionDescriptors([], "user_1", "script_1")).toEqual([]);
	});

	it("binds userId into context for executeQueryEngine", () => {
		const [descriptor] = buildApiFunctionDescriptors(["executeQueryEngine"], "user_1", "script_1");

		expect(descriptor).toEqual({
			context: { userId: "user_1" },
			functionKey: "executeQueryEngine",
		});
	});

	it("binds userId into context for getUserPreferences", () => {
		const [descriptor] = buildApiFunctionDescriptors(["getUserPreferences"], "user_1", "script_1");

		expect(descriptor).toEqual({
			context: { userId: "user_1" },
			functionKey: "getUserPreferences",
		});
	});

	it("binds scriptId into context for getCachedValue", () => {
		const [descriptor] = buildApiFunctionDescriptors(["getCachedValue"], "user_1", "script_1");

		expect(descriptor).toEqual({
			functionKey: "getCachedValue",
			context: { scriptId: "script_1" },
		});
	});

	it("binds scriptId into context for setCachedValue", () => {
		const [descriptor] = buildApiFunctionDescriptors(["setCachedValue"], "user_1", "script_1");

		expect(descriptor).toEqual({
			functionKey: "setCachedValue",
			context: { scriptId: "script_1" },
		});
	});

	it("uses an empty context for stateless functions", () => {
		const descriptors = buildApiFunctionDescriptors(
			["httpCall", "getAppConfigValue"],
			"user_1",
			"script_1",
		);

		expect(descriptors).toEqual([
			{ functionKey: "httpCall", context: {} },
			{ functionKey: "getAppConfigValue", context: {} },
		]);
	});

	it("builds one descriptor per key and preserves order", () => {
		const keys = ["executeQueryEngine", "getCachedValue", "httpCall"];
		const descriptors = buildApiFunctionDescriptors(keys, "user_1", "script_1");

		expect(descriptors.map((d) => d.functionKey)).toEqual(keys);
	});
});

describe("hostFunctionRegistry", () => {
	it("produces a callable from each factory", () => {
		for (const [key, factory] of Object.entries(hostFunctionRegistry)) {
			const fn = factory({});
			expect(typeof fn).toBe("function");
			expect(fn.name === "" || typeof fn.name === "string").toBe(true);
			void key;
		}
	});

	it("forwards bound context into executeQueryEngine", async () => {
		const factory = hostFunctionRegistry.executeQueryEngine;
		const fn = factory({ userId: "   " });

		expect(await fn(undefined)).toEqual(
			apiFailure("executeQueryEngine requires a non-empty userId in context"),
		);
	});
});
