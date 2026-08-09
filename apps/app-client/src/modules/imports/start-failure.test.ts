import { describe, expect, it } from "vitest";

import { importStartFailure } from "./start-failure";

describe("import start failure", () => {
	it("sends a rejected file extension back to the inputs", () => {
		const failure = importStartFailure(
			"Import file must have one of the following extensions: csv, json",
		);

		expect(failure.step).toBe("configure");
		expect(failure.detail).toBe(
			"That file is not a format this service can read. Choose a different file.",
		);
	});

	it("sends field problems back to the inputs without repeating the server wording", () => {
		const invalid = importStartFailure("Import source input is invalid: apiKey is required");
		const undeclared = importStartFailure(
			"Import source does not declare upload token field: extraUploadToken",
		);
		const reserved = importStartFailure(
			"Import source payload field is reserved: integrationScriptSlug",
		);

		expect([invalid.step, undeclared.step, reserved.step]).toEqual([
			"configure",
			"configure",
			"configure",
		]);
		expect(invalid.detail).toBe(
			"Some of these details could not be used. Check them and try again.",
		);
		expect(invalid.detail).not.toContain("apiKey");
	});

	it("sends configuration and availability problems back to the service choice", () => {
		const unconfigured = importStartFailure(
			"Archive importer is not configured. Set RYOT_PLUGIN_MEDIA_TOKEN.",
		);
		const missing = importStartFailure("Import source is not available");
		const workflow = importStartFailure("Import source workflow is not available");

		expect([unconfigured.step, missing.step, workflow.step]).toEqual(["pick", "pick", "pick"]);
		expect(unconfigured.detail).toBe(
			"This service is not configured on your server yet. Set what it needs, then choose it again.",
		);
		expect(missing.detail).toBe(
			"This service is no longer available on your server. Choose another one.",
		);
	});

	it("falls back to one plain sentence and stays where it is", () => {
		const unmapped = importStartFailure("Could not queue the import job; please try again");

		expect(unmapped).toEqual({
			step: undefined,
			detail: "This import could not be started. Try again.",
		});
		expect(importStartFailure(undefined)).toEqual(unmapped);
	});
});
