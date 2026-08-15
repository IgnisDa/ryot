import { ImportRequestError } from "@ryot/contract/modules/imports/schemas";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import { importStartFailure } from "./start-failure";

describe("import start failure", () => {
	it("sends a rejected file extension back to the inputs", () => {
		const failure = importStartFailure(
			Cause.fail(
				new ImportRequestError({
					reason: { code: "unsupported-file-extension", allowedExtensions: ["csv", "json"] },
				}),
			),
		);

		expect(failure.step).toBe("configure");
		expect(failure.detail).toBe(
			"That file is not a format this service can read. Choose a different file.",
		);
	});

	it("sends field problems back to the inputs without repeating the server wording", () => {
		const invalid = importStartFailure(
			Cause.fail(new ImportRequestError({ reason: { code: "invalid-input", field: "apiKey" } })),
		);

		expect(invalid.step).toBe("configure");
		expect(invalid.detail).toBe(
			"Some of these details could not be used. Check them and try again.",
		);
		expect(invalid.detail).not.toContain("apiKey");
	});

	it("sends configuration and availability problems back to the service choice", () => {
		const unconfigured = importStartFailure(
			Cause.fail(
				new ImportRequestError({
					reason: {
						source: "archive",
						code: "source-not-configured",
						missingConfigKeys: ["RYOT_PLUGIN_MEDIA_TOKEN"],
					},
				}),
			),
		);
		const missing = importStartFailure(
			Cause.fail(
				new ImportRequestError({ reason: { code: "source-not-found", source: "archive" } }),
			),
		);
		const workflow = importStartFailure(
			Cause.fail(
				new ImportRequestError({ reason: { code: "workflow-unavailable", source: "archive" } }),
			),
		);

		expect([unconfigured.step, missing.step, workflow.step]).toEqual(["pick", "pick", "pick"]);
		expect(unconfigured.detail).toBe(
			"This service is not configured on your server yet. Set what it needs, then choose it again.",
		);
		expect(missing.detail).toBe(
			"This service is no longer available on your server. Choose another one.",
		);
	});

	it("falls back to one plain sentence and stays where it is", () => {
		const unmapped = importStartFailure(Cause.fail(new Error("internal diagnostic")));

		expect(unmapped).toEqual({
			step: undefined,
			detail: "This import could not be started. Try again.",
		});
	});
});
