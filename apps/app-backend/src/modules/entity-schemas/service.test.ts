import { describe, expect, it } from "bun:test";
import {
	isEntitySchemaPropertiesShape,
	isEntitySchemaPropertiesString,
	normalizeEntitySchemaSlug,
	parseEntitySchemaPropertiesSchema,
	resolveEntitySchemaCreateInput,
	resolveEntitySchemaFacetId,
	resolveEntitySchemaName,
	resolveEntitySchemaSlug,
} from "./service";

describe("normalizeEntitySchemaSlug", () => {
	it("normalizes slug punctuation and casing", () => {
		expect(normalizeEntitySchemaSlug("  My_Custom Schema  ")).toBe(
			"my-custom-schema",
		);
	});
});

describe("resolveEntitySchemaSlug", () => {
	it("derives slug from name when omitted", () => {
		expect(resolveEntitySchemaSlug({ name: "Book Details" })).toBe(
			"book-details",
		);
	});

	it("normalizes explicit slug", () => {
		expect(
			resolveEntitySchemaSlug({
				name: "Book",
				slug: "  My_Custom Schema  ",
			}),
		).toBe("my-custom-schema");
	});

	it("throws when slug cannot be derived", () => {
		expect(() => resolveEntitySchemaSlug({ name: "!!!" })).toThrow(
			"Entity schema slug is required",
		);
	});
});

describe("resolveEntitySchemaName", () => {
	it("trims the provided name", () => {
		expect(resolveEntitySchemaName("  Book Details  ")).toBe("Book Details");
	});

	it("throws when the name is blank", () => {
		expect(() => resolveEntitySchemaName("   ")).toThrow(
			"Entity schema name is required",
		);
	});
});

describe("parseEntitySchemaPropertiesSchema", () => {
	it("accepts minimal object schema", () => {
		expect(
			parseEntitySchemaPropertiesSchema('{"type":"object","properties":{}}'),
		).toEqual({ type: "object", properties: {} });
	});

	it("accepts already-parsed object schema", () => {
		const schema = {
			type: "object" as const,
			properties: { title: { type: "string" } },
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects invalid JSON", () => {
		expect(() => parseEntitySchemaPropertiesSchema("{")).toThrow(
			"Entity schema properties schema must be valid JSON",
		);
	});

	it("rejects non-object root like array, string, or null", () => {
		for (const input of ["[]", '"hello"', "null"]) {
			expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
				"Entity schema properties schema must be a JSON object",
			);
		}
	});

	it("rejects missing properties", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema('{"type":"object"}'),
		).toThrow(
			"Entity schema properties schema must define an object properties map",
		);
	});

	it("rejects already-parsed object input with invalid properties", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ type: "object", properties: null }),
		).toThrow(
			"Entity schema properties schema must define an object properties map",
		);
	});

	it("rejects non-object type", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema('{"type":"string","properties":{}}'),
		).toThrow('Entity schema properties schema must have type "object"');
	});
});

describe("resolveEntitySchemaCreateInput", () => {
	it("returns normalized payload", () => {
		expect(
			resolveEntitySchemaCreateInput({
				name: "  Book Details  ",
				slug: "  My_Custom Schema  ",
				propertiesSchema: '{"type":"object","properties":{}}',
			}),
		).toEqual({
			name: "Book Details",
			slug: "my-custom-schema",
			propertiesSchema: { type: "object", properties: {} },
		});
	});
});

describe("resolveEntitySchemaFacetId", () => {
	it("trims the provided facet id", () => {
		expect(resolveEntitySchemaFacetId("  facet_123  ")).toBe("facet_123");
	});

	it("throws when the facet id is blank", () => {
		expect(() => resolveEntitySchemaFacetId("   ")).toThrow(
			"Facet id is required",
		);
	});
});

describe("entity schema schemas", () => {
	it("rejects properties schema objects with extra top-level keys", () => {
		expect(
			isEntitySchemaPropertiesShape({
				extra: true,
				type: "object",
				properties: {},
			}),
		).toBeFalse();
	});

	it("accepts the canonical object properties schema shape", () => {
		expect(
			isEntitySchemaPropertiesShape({ type: "object", properties: {} }),
		).toBeTrue();
	});

	it("rejects string properties schema values that do not parse to the canonical shape", () => {
		expect(
			isEntitySchemaPropertiesString(
				'{"type":"object","properties":{},"extra":true}',
			),
		).toBeFalse();
	});

	it("accepts string properties schema values that parse to the canonical shape", () => {
		expect(
			isEntitySchemaPropertiesString('{"type":"object","properties":{}}'),
		).toBeTrue();
	});
});
