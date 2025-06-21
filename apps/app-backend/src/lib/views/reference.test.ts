import { describe, expect, it } from "bun:test";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import { buildSchemaMap, getPropertyType } from "./reference";

const smartphoneSchema = createSmartphoneSchema();

describe("getPropertyType", () => {
	it("returns property types for supported primitives", () => {
		expect(getPropertyType(smartphoneSchema, ["nameplate"])).toBe("string");
		expect(getPropertyType(smartphoneSchema, ["releaseYear"])).toBe("integer");
		expect(getPropertyType(smartphoneSchema, ["screenSize"])).toBe("number");
		expect(getPropertyType(smartphoneSchema, ["isFoldable"])).toBe("boolean");
		expect(getPropertyType(smartphoneSchema, ["announcedAt"])).toBe("date");
	});

	it("traverses nested object property paths", () => {
		expect(getPropertyType(smartphoneSchema, ["metadata", "source"])).toBe(
			"string",
		);
	});

	it("returns null for an empty property path", () => {
		expect(getPropertyType(smartphoneSchema, [])).toBeNull();
	});

	it("returns null for an unknown property", () => {
		expect(getPropertyType(smartphoneSchema, ["missingProperty"])).toBeNull();
	});

	it("returns null when an intermediate segment is not an object type", () => {
		expect(
			getPropertyType(smartphoneSchema, ["nameplate", "nonexistent"]),
		).toBeNull();
	});

	it("returns null when a nested segment is missing", () => {
		expect(
			getPropertyType(smartphoneSchema, ["metadata", "nonexistent"]),
		).toBeNull();
	});

	it("traverses three levels of nested object property paths", () => {
		const deepSchema = {
			slug: "deep",
			propertiesSchema: {
				fields: {
					meta: {
						label: "Meta",
						type: "object" as const,
						properties: {
							source: {
								label: "Source",
								type: "object" as const,
								properties: {
									origin: { label: "Origin", type: "string" as const },
								},
							},
						},
					},
				},
			},
		};

		expect(getPropertyType(deepSchema, ["meta", "source", "origin"])).toBe(
			"string",
		);
		expect(
			getPropertyType(deepSchema, ["meta", "source", "nonexistent"]),
		).toBeNull();
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
