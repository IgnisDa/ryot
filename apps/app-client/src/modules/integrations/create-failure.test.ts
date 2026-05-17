import { IntegrationRequestError } from "@ryot/contract/modules/integrations/schemas";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import { integrationSaveFailure } from "./create-failure";

describe("integration save failure", () => {
	it("sends invalid provider settings back to the settings step", () => {
		expect(
			integrationSaveFailure(
				Cause.fail(
					new IntegrationRequestError({
						reason: { code: "invalid-provider-settings", provider: "komga" },
					}),
				),
			),
		).toEqual({
			step: "configure",
			detail: "Some of these details could not be used. Check them and try again.",
		});
	});

	it("explains the cross-field progress rule the schema cannot express", () => {
		expect(
			integrationSaveFailure(
				Cause.fail(
					new IntegrationRequestError({
						reason: { code: "invalid-progress-range", minimumProgress: 90, maximumProgress: 10 },
					}),
				),
			).detail,
		).toBe("The lowest progress must not be higher than the highest progress.");
		expect(
			integrationSaveFailure(
				Cause.fail(
					new IntegrationRequestError({
						reason: { code: "progress-out-of-range", field: "maximumProgress", value: 101 },
					}),
				),
			).detail,
		).toBe("Progress values must be between 0 and 100.");
	});

	it("sends an unregistered provider back to the provider step", () => {
		expect(
			integrationSaveFailure(
				Cause.fail(
					new IntegrationRequestError({
						reason: { code: "provider-not-found", provider: "komga" },
					}),
				),
			).step,
		).toBe("pick");
	});

	it("falls back to a generic detail with no step for unknown messages", () => {
		expect(integrationSaveFailure(Cause.fail(new Error("internal diagnostic")))).toEqual({
			step: undefined,
			detail: "This integration could not be saved. Try again.",
		});
	});
});
