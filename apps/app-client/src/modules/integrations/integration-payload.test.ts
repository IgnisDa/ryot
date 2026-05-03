import { describe, expect, it } from "vitest";

import { makeListedIntegration, sinkProvider, yankProvider } from "./integration-fixture";
import {
	createIntegrationBody,
	initialIntegrationFormValues,
	storedIntegrationFormValues,
	updateIntegrationBody,
} from "./integration-payload";

const filled = {
	...initialIntegrationFormValues(yankProvider),
	name: "Shelf",
	apiKey: "secret",
	tagIds: ["a", "b"],
	baseUrl: "https://komga.example",
};

describe("integration payload", () => {
	it("nests the continuous-error flag under extraSettings", () => {
		const body = createIntegrationBody({
			provider: yankProvider,
			values: { ...filled, disableOnContinuousErrors: true },
		});

		expect(body.extraSettings).toEqual({ disableOnContinuousErrors: true });
		expect(body).not.toHaveProperty("disableOnContinuousErrors");
	});

	it("splits values between the common body and providerSpecifics", () => {
		const body = createIntegrationBody({ provider: yankProvider, values: filled });

		expect(body.name).toBe("Shelf");
		expect(body.provider).toBe("komga");
		expect(body.minimumProgress).toBe(2);
		expect(body.syncOwnership).toBe(false);
		expect(body.providerSpecifics).toEqual({
			kind: "komga",
			apiKey: "secret",
			tagIds: ["a", "b"],
			baseUrl: "https://komga.example",
		});
	});

	it("omits common fields the provider schema does not render", () => {
		const body = createIntegrationBody({
			provider: sinkProvider,
			values: initialIntegrationFormValues(sinkProvider),
		});

		expect(body).not.toHaveProperty("syncOwnership");
		expect(body.minimumProgress).toBe(2);
	});

	it("carries an emptied list so a stored list can be cleared", () => {
		const body = updateIntegrationBody({
			provider: yankProvider,
			values: { ...filled, tagIds: [] },
		});

		expect(body.providerSpecifics?.["tagIds"]).toEqual([]);
	});

	it("omits a blank secret so the stored one survives an update", () => {
		const body = updateIntegrationBody({
			provider: yankProvider,
			values: { ...filled, apiKey: "" },
		});

		expect(body.providerSpecifics).not.toHaveProperty("apiKey");
		expect(body.providerSpecifics?.["baseUrl"]).toBe("https://komga.example");
	});

	it("seeds an edit form from the stored integration and leaves secrets blank", () => {
		const values = storedIntegrationFormValues({
			provider: yankProvider,
			integration: makeListedIntegration({
				name: "Shelf",
				isDisabled: true,
				minimumProgress: 10,
				providerSpecifics: { kind: "komga", tagIds: ["a"], baseUrl: "https://komga.example" },
			}),
		});

		expect(values).toMatchObject({
			name: "Shelf",
			tagIds: ["a"],
			isDisabled: true,
			apiKey: undefined,
			minimumProgress: 10,
			baseUrl: "https://komga.example",
		});
	});

	it("ignores stored settings that do not fit the declared schema", () => {
		const values = storedIntegrationFormValues({
			provider: yankProvider,
			integration: makeListedIntegration({
				providerSpecifics: { kind: "komga", baseUrl: { nested: true }, tagIds: [{ bad: 1 }] },
			}),
		});

		expect(values.baseUrl).toBeUndefined();
		expect(values.tagIds).toBeUndefined();
	});
});
