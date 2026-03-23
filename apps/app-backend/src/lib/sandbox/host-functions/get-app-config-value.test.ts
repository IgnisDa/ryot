import { describe, expect, it } from "bun:test";
import { appConfig } from "~/lib/config";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";
import { getAppConfigValue } from "./get-app-config-value";

describe("getAppConfigValue", () => {
	it("returns the configured value for a known key", async () => {
		expect(
			getAppConfigValue({}, "  BOOKS_HARDCOVER_API_KEY  "),
		).resolves.toEqual(apiSuccess(appConfig.BOOKS_HARDCOVER_API_KEY ?? null));
	});

	it("returns validation failure for a blank key", async () => {
		expect(getAppConfigValue({}, "   ")).resolves.toEqual(
			apiFailure("getAppConfigValue expects a non-empty key string"),
		);
	});

	it("returns failure for an unknown key", async () => {
		expect(getAppConfigValue({}, "UNKNOWN_CONFIG_KEY")).resolves.toEqual(
			apiFailure('Config key "UNKNOWN_CONFIG_KEY" does not exist'),
		);
	});
});
