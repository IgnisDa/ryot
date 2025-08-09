import { describe, expect, it } from "bun:test";

import { appConfigEnvIndex, appConfigPathIndex } from "~/lib/config";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";

import { getAppConfigValue } from "./get-app-config-value";

describe("getAppConfigValue", () => {
	it("returns the configured value for a known path", async () => {
		const envKey = appConfigPathIndex["books.hardcover.apiKey"];
		expect(getAppConfigValue({}, "  books.hardcover.apiKey  ")).resolves.toEqual(
			apiSuccess(appConfigEnvIndex[envKey] ?? null),
		);
	});

	it("returns validation failure for a blank key", async () => {
		expect(getAppConfigValue({}, "   ")).resolves.toEqual(
			apiFailure("getAppConfigValue expects a non-empty key string"),
		);
	});

	it("returns failure for an unknown key", async () => {
		expect(getAppConfigValue({}, "books.unknown.key")).resolves.toEqual(
			apiFailure('Config key "books.unknown.key" does not exist'),
		);
	});
});
