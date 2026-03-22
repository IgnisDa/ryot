import { describe, expect, it } from "bun:test";
import { createEntitySchemaFixture } from "#/features/test-fixtures";
import { resolvePropertyType } from "./resolve-property-type";

const animeSchema = createEntitySchemaFixture({
	slug: "anime",
	propertiesSchema: {
		aired: { type: "date" },
		year: { type: "integer" },
		title: { type: "string" },
		score: { type: "number" },
		ongoing: { type: "boolean" },
		meta: { type: "object", properties: {} },
		genres: { type: "array", items: { type: "string" } },
	},
});

const emptySchemas = [] as (typeof animeSchema)[];

describe("resolvePropertyType - built-in paths", () => {
	it("returns string for @name", () => {
		expect(resolvePropertyType("@name", emptySchemas)).toBe("string");
	});

	it("returns date for @createdAt", () => {
		expect(resolvePropertyType("@createdAt", emptySchemas)).toBe("date");
	});

	it("returns date for @updatedAt", () => {
		expect(resolvePropertyType("@updatedAt", emptySchemas)).toBe("date");
	});

	it("returns null for @image", () => {
		expect(resolvePropertyType("@image", emptySchemas)).toBeNull();
	});

	it("returns null for unknown @something", () => {
		expect(resolvePropertyType("@unknown", emptySchemas)).toBeNull();
		expect(resolvePropertyType("@anything", emptySchemas)).toBeNull();
	});
});

describe("resolvePropertyType - schema.property paths", () => {
	it("returns integer for anime.year", () => {
		expect(resolvePropertyType("anime.year", [animeSchema])).toBe("integer");
	});

	it("returns string for anime.title", () => {
		expect(resolvePropertyType("anime.title", [animeSchema])).toBe("string");
	});

	it("returns number for anime.score", () => {
		expect(resolvePropertyType("anime.score", [animeSchema])).toBe("number");
	});

	it("returns date for anime.aired", () => {
		expect(resolvePropertyType("anime.aired", [animeSchema])).toBe("date");
	});

	it("returns boolean for anime.ongoing", () => {
		expect(resolvePropertyType("anime.ongoing", [animeSchema])).toBe("boolean");
	});

	it("returns array for anime.genres", () => {
		expect(resolvePropertyType("anime.genres", [animeSchema])).toBe("array");
	});

	it("returns object for anime.meta", () => {
		expect(resolvePropertyType("anime.meta", [animeSchema])).toBe("object");
	});

	it("returns null when schema is not in the array", () => {
		expect(resolvePropertyType("anime.year", emptySchemas)).toBeNull();
		expect(
			resolvePropertyType("anime.year", [
				createEntitySchemaFixture({ slug: "manga" }),
			]),
		).toBeNull();
	});

	it("returns null when property does not exist in the schema", () => {
		expect(resolvePropertyType("anime.nonexistent", [animeSchema])).toBeNull();
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
});
