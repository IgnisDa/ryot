import { describe, expect, it } from "bun:test";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import {
	buildSchemaMap,
	getPropertyType,
	parseFieldPath,
} from "./schema-introspection";

const smartphoneSchema = createSmartphoneSchema();

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
	it("parses top-level references", () => {
		expect(parseFieldPath("@name")).toEqual({
			column: "name",
			type: "top-level",
		});
	});

	it("parses schema-qualified property references", () => {
		expect(parseFieldPath("smartphones.year")).toEqual({
			property: "year",
			slug: "smartphones",
			type: "schema-property",
		});
	});

	it("rejects malformed field paths", () => {
		expect(() => parseFieldPath("year")).toThrow("Invalid field path: year");
		expect(() => parseFieldPath("smartphones.year.value")).toThrow(
			"Invalid field path: smartphones.year.value",
		);
	});
});
