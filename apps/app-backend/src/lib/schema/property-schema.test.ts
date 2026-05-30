import { describe, expect, it } from "vitest";

import {
	moviePropertiesSchema,
	personPropertiesSchema,
} from "#lib/builtins/media-property-schemas";

import { collectTranslatableProperties } from "./property-schema";

describe("collectTranslatableProperties", () => {
	it("marks description translatable while leaving genres and other properties canonical", () => {
		const keys = collectTranslatableProperties(moviePropertiesSchema);

		expect(keys).toContain("description");
		expect(keys).not.toContain("genres");
		expect(keys).not.toContain("runtime");
	});

	it("treats a person's biography (stored as description) as the only translatable property", () => {
		expect(collectTranslatableProperties(personPropertiesSchema)).toEqual(["description"]);
	});
});
