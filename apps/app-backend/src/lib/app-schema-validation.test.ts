import { describe, expect, it } from "bun:test";
import { parseAppSchemaProperties } from "./app-schema-validation";

describe("parseAppSchemaProperties", () => {
	it("validates properties against the provided app schema", () => {
		const propertiesSchema = {
			note: { type: "string" as const },
			rating: { type: "number" as const, required: true as const },
		};

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
					rating: { type: "number" as const, required: true as const },
				},
			}),
		).toThrow("Entity properties validation failed");
	});
});
