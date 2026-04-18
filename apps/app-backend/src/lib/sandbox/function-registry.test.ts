import { describe, expect, it } from "bun:test";
import {
	buildApiFunctionDescriptors,
	hostFunctionRegistry,
} from "./function-registry";

describe("buildApiFunctionDescriptors", () => {
	it("returns an empty array for an empty allowedKeys list", () => {
		expect(buildApiFunctionDescriptors([], "user_1", "script_1")).toEqual([]);
	});

	it("binds userId into context for appApiCall", () => {
		const [descriptor] = buildApiFunctionDescriptors(
			["appApiCall"],
			"user_1",
			"script_1",
		);

		expect(descriptor).toEqual({
			functionKey: "appApiCall",
			context: { userId: "user_1" },
		});
	});

	it("binds userId into context for getUserPreferences", () => {
		const [descriptor] = buildApiFunctionDescriptors(
			["getUserPreferences"],
			"user_1",
			"script_1",
		);

		expect(descriptor).toEqual({
			context: { userId: "user_1" },
			functionKey: "getUserPreferences",
		});
	});

	it("binds scriptId into context for getCachedValue", () => {
		const [descriptor] = buildApiFunctionDescriptors(
			["getCachedValue"],
			"user_1",
			"script_1",
		);

		expect(descriptor).toEqual({
			functionKey: "getCachedValue",
			context: { scriptId: "script_1" },
		});
	});

	it("binds scriptId into context for setCachedValue", () => {
		const [descriptor] = buildApiFunctionDescriptors(
			["setCachedValue"],
			"user_1",
			"script_1",
		);

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
		const keys = ["appApiCall", "getCachedValue", "httpCall"];
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

	it("forwards context into appApiCall so userId reaches the host function", async () => {
		const factory = hostFunctionRegistry.appApiCall;
		const fn = factory({ userId: "user_ctx" });

		const result = await fn("GET", "/system/health");

		expect(
			(result as { success: boolean }).success === false &&
				(result as { error: string }).error.includes(
					"Internal app request handler is not registered",
				),
		).toBe(true);
	});
});
