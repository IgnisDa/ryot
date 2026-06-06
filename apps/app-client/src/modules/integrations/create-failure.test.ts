import { describe, expect, it } from "vitest";

import { integrationSaveFailure } from "./create-failure";

describe("integration save failure", () => {
	it("sends invalid provider settings back to the settings step", () => {
		expect(integrationSaveFailure("Invalid providerSpecifics: baseUrl is required")).toEqual({
			step: "configure",
			detail: "Some of these details could not be used. Check them and try again.",
		});
	});

	it("explains the cross-field progress rule the schema cannot express", () => {
		expect(integrationSaveFailure("minimumProgress must not exceed maximumProgress").detail).toBe(
			"The lowest progress must not be higher than the highest progress.",
		);
		expect(integrationSaveFailure("maximumProgress must be between 0 and 100").detail).toBe(
			"Progress values must be between 0 and 100.",
		);
	});

	it("sends an unregistered provider back to the provider step", () => {
		expect(integrationSaveFailure("Integration provider 'komga' is not registered").step).toBe(
			"pick",
		);
	});

	it("falls back to a generic detail with no step for unknown messages", () => {
		expect(integrationSaveFailure("something else entirely")).toEqual({
			step: undefined,
			detail: "This integration could not be saved. Try again.",
		});
		expect(integrationSaveFailure(undefined).step).toBeUndefined();
	});
});
