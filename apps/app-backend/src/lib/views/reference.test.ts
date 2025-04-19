import { describe, expect, it } from "bun:test";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import { buildSchemaMap, getPropertyType, parseFieldPath } from "./reference";

const smartphoneSchema = createSmartphoneSchema();

const entityField = (schemaSlug: string, field: string) => {
	return `entity.${schemaSlug}.${field}`;
};

describe("getPropertyType", () => {
	it("returns property types for supported primitives", () => {
		expect(getPropertyType(smartphoneSchema, "nameplate")).toBe("string");
		expect(getPropertyType(smartphoneSchema, "releaseYear")).toBe("integer");
		expect(getPropertyType(smartphoneSchema, "screenSize")).toBe("number");
		expect(getPropertyType(smartphoneSchema, "isFoldable")).toBe("boolean");
		expect(getPropertyType(smartphoneSchema, "announcedAt")).toBe("date");
	});

	it("returns null for an unknown property", () => {
		expect(getPropertyType(smartphoneSchema, "missingProperty")).toBeNull();
	});
});

describe("buildSchemaMap", () => {
	it("indexes schemas by slug", () => {
		const tabletSchema = createTabletSchema();

		const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);

		expect(schemaMap.get("smartphones")).toEqual(smartphoneSchema);
		expect(schemaMap.get("tablets")).toEqual(tabletSchema);
		expect(schemaMap.size).toBe(2);
	});
});

describe("parseFieldPath", () => {
	it("parses entity-qualified built-in references", () => {
		expect(parseFieldPath(entityField("smartphones", "@name"))).toEqual({
			column: "name",
			slug: "smartphones",
			type: "entity-column",
		});
	});

	it("parses entity-qualified property references", () => {
		expect(parseFieldPath(entityField("smartphones", "year"))).toEqual({
			property: "year",
			slug: "smartphones",
			type: "schema-property",
		});
	});

	it("parses joined event property references", () => {
		expect(parseFieldPath("event.review.rating")).toEqual({
			joinKey: "review",
			property: "rating",
			type: "event-join-property",
		});
	});

	it("parses joined event column references", () => {
		expect(parseFieldPath("event.review.@createdAt")).toEqual({
			joinKey: "review",
			column: "createdAt",
			type: "event-join-column",
		});
	});

	it("rejects malformed field paths", () => {
		expect(() => parseFieldPath("@name")).toThrow("Invalid field path: @name");
		expect(() => parseFieldPath("year")).toThrow("Invalid field path: year");
		expect(() => parseFieldPath("smartphones.year")).toThrow(
			"Invalid field path: smartphones.year",
		);
		expect(() => parseFieldPath("entity.smartphones.year.value")).toThrow(
			"Invalid field path: entity.smartphones.year.value",
		);
		expect(() => parseFieldPath("event.review")).toThrow(
			"Invalid field path: event.review",
		);
	});
});
