import { describe, expect, it } from "bun:test";
import { createEntitySchemaFixture } from "#/features/test-fixtures";
import { resolvePropertyType } from "./resolve-property-type";

const animeSchema = createEntitySchemaFixture({
	slug: "anime",
	propertiesSchema: {
		fields: {
			aired: { type: "date" },
			year: { type: "integer" },
			title: { type: "string" },
			score: { type: "number" },
			ongoing: { type: "boolean" },
			meta: { type: "object", properties: {} },
			genres: { type: "array", items: { type: "string" } },
		},
	},
});

const emptySchemas = [] as (typeof animeSchema)[];

describe("resolvePropertyType - built-in paths", () => {
	it("returns string for entity.anime.@name", () => {
		expect(resolvePropertyType("entity.anime.@name", emptySchemas)).toBe(
			"string",
		);
	});

	it("returns date for entity.anime.@createdAt", () => {
		expect(resolvePropertyType("entity.anime.@createdAt", emptySchemas)).toBe(
			"date",
		);
	});

	it("returns date for entity.anime.@updatedAt", () => {
		expect(resolvePropertyType("entity.anime.@updatedAt", emptySchemas)).toBe(
			"date",
		);
	});

	it("returns null for entity.anime.@image", () => {
		expect(resolvePropertyType("entity.anime.@image", emptySchemas)).toBeNull();
	});

	it("returns null for unknown entity built-ins", () => {
		expect(
			resolvePropertyType("entity.anime.@unknown", emptySchemas),
		).toBeNull();
		expect(
			resolvePropertyType("entity.anime.@anything", emptySchemas),
		).toBeNull();
	});
});

describe("resolvePropertyType - entity.schema.property paths", () => {
	it("returns integer for entity.anime.year", () => {
		expect(resolvePropertyType("entity.anime.year", [animeSchema])).toBe(
			"integer",
		);
	});

	it("returns string for entity.anime.title", () => {
		expect(resolvePropertyType("entity.anime.title", [animeSchema])).toBe(
			"string",
		);
	});

	it("returns number for entity.anime.score", () => {
		expect(resolvePropertyType("entity.anime.score", [animeSchema])).toBe(
			"number",
		);
	});

	it("returns date for entity.anime.aired", () => {
		expect(resolvePropertyType("entity.anime.aired", [animeSchema])).toBe(
			"date",
		);
	});

	it("returns boolean for entity.anime.ongoing", () => {
		expect(resolvePropertyType("entity.anime.ongoing", [animeSchema])).toBe(
			"boolean",
		);
	});

	it("returns array for entity.anime.genres", () => {
		expect(resolvePropertyType("entity.anime.genres", [animeSchema])).toBe(
			"array",
		);
	});

	it("returns object for entity.anime.meta", () => {
		expect(resolvePropertyType("entity.anime.meta", [animeSchema])).toBe(
			"object",
		);
	});

	it("returns null when schema is not in the array", () => {
		expect(resolvePropertyType("entity.anime.year", emptySchemas)).toBeNull();
		expect(
			resolvePropertyType("entity.anime.year", [
				createEntitySchemaFixture({ slug: "manga" }),
			]),
		).toBeNull();
	});

	it("returns null when property does not exist in the schema", () => {
		expect(
			resolvePropertyType("entity.anime.nonexistent", [animeSchema]),
		).toBeNull();
	});
});

describe("resolvePropertyType - edge cases", () => {
	it("returns null for empty string", () => {
		expect(resolvePropertyType("", [animeSchema])).toBeNull();
	});

	it("returns null for single-segment bare-word (ambiguous)", () => {
		expect(resolvePropertyType("bare-word", [animeSchema])).toBeNull();
		expect(resolvePropertyType("year", [animeSchema])).toBeNull();
	});

	it("returns null for event references", () => {
		expect(
			resolvePropertyType("event.review.rating", [animeSchema]),
		).toBeNull();
	});
});
