import { describe, expect, it } from "vitest";

import type { AppSchema } from "#lib/schema";

import {
	buildSchemaMap,
	getEntitySchemaColumnPropertyType,
	getEventJoinPropertyDefinition,
	getPropertyType,
} from "./reference";
import { createEventJoin, createEventSchema, smartphoneSchema, tabletSchema } from "./test-support";

describe("getPropertyType", () => {
	it("returns property types for supported primitives", () => {
		expect(getPropertyType(smartphoneSchema, ["nameplate"])).toBe("string");
		expect(getPropertyType(smartphoneSchema, ["releaseYear"])).toBe("integer");
		expect(getPropertyType(smartphoneSchema, ["screenSize"])).toBe("number");
		expect(getPropertyType(smartphoneSchema, ["isFoldable"])).toBe("boolean");
		expect(getPropertyType(smartphoneSchema, ["announcedAt"])).toBe("date");
	});

	it("traverses nested object property paths", () => {
		expect(getPropertyType(smartphoneSchema, ["metadata", "source"])).toBe("string");
	});

	it("returns null for an empty property path", () => {
		expect(getPropertyType(smartphoneSchema, [])).toBeNull();
	});

	it("returns null for an unknown property", () => {
		expect(getPropertyType(smartphoneSchema, ["missingProperty"])).toBeNull();
	});

	it("returns null when an intermediate segment is not an object type", () => {
		expect(getPropertyType(smartphoneSchema, ["nameplate", "nonexistent"])).toBeNull();
	});

	it("returns null when a nested segment is missing", () => {
		expect(getPropertyType(smartphoneSchema, ["metadata", "nonexistent"])).toBeNull();
	});

	it("traverses three levels of nested object property paths", () => {
		const deepSchema = {
			slug: "deep",
			propertiesSchema: {
				fields: {
					meta: {
						label: "Meta",
						type: "object",
						description: "Metadata",
						properties: {
							source: {
								type: "object",
								label: "Source",
								description: "Source details",
								properties: {
									origin: { type: "string", label: "Origin", description: "Origin value" },
								},
							},
						},
					},
				},
			} satisfies AppSchema,
		};

		expect(getPropertyType(deepSchema, ["meta", "source", "origin"])).toBe("string");
		expect(getPropertyType(deepSchema, ["meta", "source", "nonexistent"])).toBeNull();
	});
});

describe("buildSchemaMap", () => {
	it("indexes schemas by slug", () => {
		const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);

		expect(schemaMap.get("smartphones")).toEqual(smartphoneSchema);
		expect(schemaMap.get("tablets")).toEqual(tabletSchema);
		expect(schemaMap.size).toBe(2);
	});
});

describe("getEventJoinPropertyDefinition", () => {
	it("accepts event schemas that only differ by label or description", () => {
		const definition = getEventJoinPropertyDefinition(
			createEventJoin([
				createEventSchema({
					id: "event-schema-1",
					entitySchemaId: "schema-1",
					entitySchemaSlug: "smartphones",
					propertiesSchema: {
						fields: {
							rating: {
								type: "number",
								label: "Rating",
								validation: { required: true },
								description: "Phone review score",
							},
						},
					} satisfies AppSchema,
				}),
				createEventSchema({
					id: "event-schema-2",
					entitySchemaId: "schema-2",
					entitySchemaSlug: "tablets",
					propertiesSchema: {
						fields: {
							rating: {
								type: "number",
								label: "Score",
								validation: { required: true },
								description: "Tablet review score",
							},
						},
					} satisfies AppSchema,
				}),
			]),
			["rating"],
		);

		expect(definition).toEqual({
			type: "number",
			label: "Rating",
			validation: { required: true },
			description: "Phone review score",
		});
	});
});

describe("getEntitySchemaColumnPropertyType", () => {
	it("returns 'boolean' for isBuiltin", () => {
		expect(getEntitySchemaColumnPropertyType("isBuiltin")).toBe("boolean");
	});

	it("returns 'datetime' for createdAt", () => {
		expect(getEntitySchemaColumnPropertyType("createdAt")).toBe("datetime");
	});

	it("returns 'datetime' for updatedAt", () => {
		expect(getEntitySchemaColumnPropertyType("updatedAt")).toBe("datetime");
	});

	it("returns 'string' for icon", () => {
		expect(getEntitySchemaColumnPropertyType("icon")).toBe("string");
	});

	it("returns 'string' for string columns (slug, name, id, accentColor, userId)", () => {
		expect(getEntitySchemaColumnPropertyType("slug")).toBe("string");
		expect(getEntitySchemaColumnPropertyType("name")).toBe("string");
		expect(getEntitySchemaColumnPropertyType("id")).toBe("string");
		expect(getEntitySchemaColumnPropertyType("userId")).toBe("string");
		expect(getEntitySchemaColumnPropertyType("accentColor")).toBe("string");
	});

	it("returns null for an unknown column", () => {
		expect(getEntitySchemaColumnPropertyType("propertiesSchema")).toBeNull();
		expect(getEntitySchemaColumnPropertyType("unknown")).toBeNull();
	});

	it("returns null for an empty column name", () => {
		expect(getEntitySchemaColumnPropertyType("")).toBeNull();
	});
});
