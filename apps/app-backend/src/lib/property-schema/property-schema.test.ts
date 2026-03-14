import {
	type AppSchema,
	collectSecretProperties,
	collectTranslatableProperties,
} from "@ryot/contract/schema/property-schema";
import {
	moviePropertiesSchema,
	personPropertiesSchema,
} from "@ryot/media-fitness/schemas/property-schemas";
import { describe, expect, it } from "vitest";

describe("collectTranslatableProperties", () => {
	it("marks description translatable while leaving genres and other properties canonical", () => {
		const keys = collectTranslatableProperties(moviePropertiesSchema);

		expect(keys).toContain("description");
		expect(keys).not.toContain("genres");
		expect(keys).not.toContain("runtime");
	});

	it("treats a person's images and biography (description) as the translatable properties", () => {
		expect(collectTranslatableProperties(personPropertiesSchema)).toEqual([
			"images",
			"description",
		]);
	});
});

describe("collectSecretProperties", () => {
	const settingsSchema: AppSchema = {
		fields: {
			baseUrl: { type: "string", label: "Base URL", description: "Instance base URL" },
			apiKey: { secret: true, type: "string", label: "API key", description: "Provider API key" },
			password: {
				secret: true,
				type: "string",
				label: "Password",
				description: "Account password",
			},
		},
	};

	it("collects only the properties marked secret", () => {
		expect(collectSecretProperties(settingsSchema)).toEqual(["apiKey", "password"]);
	});

	it("returns nothing for a schema without secret properties", () => {
		expect(collectSecretProperties(personPropertiesSchema)).toEqual([]);
	});
});
