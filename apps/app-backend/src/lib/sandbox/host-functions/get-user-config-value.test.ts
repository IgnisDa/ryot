import { describe, expect, it } from "bun:test";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";
import { getUserConfigValue } from "./get-user-config-value";

describe("getUserConfigValue", () => {
	it("returns the stubbed value for a known key", async () => {
		expect(getUserConfigValue({}, " pageSize ")).resolves.toEqual(
			apiSuccess(20),
		);
	});

	it("returns validation failure for a blank key", async () => {
		expect(getUserConfigValue({}, "   ")).resolves.toEqual(
			apiFailure("getUserConfigValue expects a non-empty key string"),
		);
	});

	it("returns failure for an unknown key", async () => {
		expect(getUserConfigValue({}, "timezone")).resolves.toEqual(
			apiFailure('User config key "timezone" does not exist'),
		);
	});
});
