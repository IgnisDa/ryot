import { collectTranslatableProperties } from "@ryot/contract/schema/property-schema";
import {
	moviePropertiesSchema,
	personPropertiesSchema,
} from "@ryot/plugin-media/schemas/property-schemas";
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
