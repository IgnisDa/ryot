import { describe, expect, it } from "bun:test";
import { createNoteAndRatingPropertiesSchema } from "~/lib/test-fixtures";
import { parseAppSchemaProperties } from "./schema-validation";

describe("parseAppSchemaProperties", () => {
	it("validates properties against the provided app schema", () => {
		const propertiesSchema = createNoteAndRatingPropertiesSchema();

		expect(
			parseAppSchemaProperties({
				kind: "Event",
				propertiesSchema,
				properties: { note: "Great tasting", rating: 4.5 },
			}),
		).toEqual({ note: "Great tasting", rating: 4.5 });
	});

	it("rejects invalid properties with a kind-specific error", () => {
		expect(() =>
			parseAppSchemaProperties({
				kind: "Entity",
				properties: { rating: "bad" },
				propertiesSchema: {
					rating: createNoteAndRatingPropertiesSchema().rating,
				},
			}),
		).toThrow("Entity properties validation failed");
	});
});
