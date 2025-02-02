import { describe, expect, it } from "bun:test";
import {
	parseEntitySchemaPropertiesSchema,
	resolveEntitySchemaCreateInput,
	resolveEntitySchemaFacetId,
	resolveEntitySchemaName,
} from "./service";

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
	it("accepts flat properties map", () => {
		expect(
			parseEntitySchemaPropertiesSchema({
				title: { type: "string" },
				pages: { type: "integer" },
			}),
		).toEqual({
			title: { type: "string" },
			pages: { type: "integer" },
		});
	});

	it("accepts already-parsed properties map", () => {
		const schema = {
			title: { type: "string" as const },
			pages: { type: "integer" as const, nullable: true as const },
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects non-object root like array, string, or null", () => {
		for (const input of [[], "hello", null]) {
			expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
				"Entity schema properties schema must be a JSON object",
			);
		}
	});

	it("rejects string inputs", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema('{"title":{"type":"string"}}'),
		).toThrow("Entity schema properties schema must be a JSON object");
	});

	it("rejects empty properties map", () => {
		expect(() => parseEntitySchemaPropertiesSchema({})).toThrow(
			"Entity schema properties must contain at least one property",
		);
	});

	it("rejects property without type field", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ title: { required: true } }),
		).toThrow('Property "title" must have a type field');
	});

	it("rejects property with invalid type", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ title: { type: "invalid" } }),
		).toThrow('Property "title" has invalid type "invalid"');
	});

	it("rejects array property without items", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ tags: { type: "array" } }),
		).toThrow('Property "tags" with type "array" must have an items field');
	});

	it("rejects object property without properties", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ metadata: { type: "object" } }),
		).toThrow(
			'Property "metadata" with type "object" must have a properties field',
		);
	});

	it("accepts complex nested structure", () => {
		const schema = {
			people: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						role: { type: "string" as const },
						identifier: { type: "string" as const },
					},
				},
			},
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("validates recursively nested arrays", () => {
		const schema = {
			matrix: {
				type: "array" as const,
				items: {
					type: "array" as const,
					items: { type: "number" as const },
				},
			},
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});
});

describe("resolveEntitySchemaCreateInput", () => {
	it("returns normalized payload", () => {
		expect(
			resolveEntitySchemaCreateInput({
				name: "  Book Details  ",
				slug: "  My_Custom Schema  ",
				propertiesSchema: { title: { type: "string" } },
			}),
		).toEqual({
			name: "Book Details",
			slug: "my-custom-schema",
			propertiesSchema: { title: { type: "string" } },
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
