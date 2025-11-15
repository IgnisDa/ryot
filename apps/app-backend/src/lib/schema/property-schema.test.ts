import { collectTranslatableProperties } from "@ryot/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import {
	moviePropertiesSchema,
	personPropertiesSchema,
} from "#lib/builtins/media-property-schemas";

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
