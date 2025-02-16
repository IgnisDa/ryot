import { describe, expect, it } from "bun:test";
import {
	parseEntitySchemaPropertiesSchema,
	resolveEntitySchemaAccentColor,
	resolveEntitySchemaCreateInput,
	resolveEntitySchemaFacetId,
	resolveEntitySchemaIcon,
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

describe("resolveEntitySchemaIcon", () => {
	it("trims the provided icon", () => {
		expect(resolveEntitySchemaIcon("  book-open  ")).toBe("book-open");
	});

	it("throws when the icon is blank", () => {
		expect(() => resolveEntitySchemaIcon("   ")).toThrow(
			"Entity schema icon is required",
		);
	});
});

describe("resolveEntitySchemaAccentColor", () => {
	it("trims the provided accent color", () => {
		expect(resolveEntitySchemaAccentColor("  #5B7FFF  ")).toBe("#5B7FFF");
	});

	it("throws when the accent color is blank", () => {
		expect(() => resolveEntitySchemaAccentColor("   ")).toThrow(
			"Entity schema accent color is required",
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
			pages: { type: "integer" as const },
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects non-object root like array, string, or null", () => {
		for (const input of [[], "hello", null]) {
			if (Array.isArray(input))
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected record, received array",
				);
			else if (input === null)
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected record, received null",
				);
			else
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected record, received string",
				);
		}
	});

	it("rejects empty properties map", () => {
		expect(() => parseEntitySchemaPropertiesSchema({})).toThrow(
			"Entity schema properties must contain at least one property",
		);
	});

	it("rejects property without type field", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ title: { required: true } }),
		).toThrow("Invalid input");
	});

	it("rejects property with invalid type", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ title: { type: "invalid" } }),
		).toThrow("Invalid input");
	});

	it("rejects array property without items", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ tags: { type: "array" } }),
		).toThrow("Invalid input: expected object, received undefined");
	});

	it("rejects object property without properties", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ metadata: { type: "object" } }),
		).toThrow("Invalid input: expected record, received undefined");
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
				icon: "  book-open  ",
				name: "  Book Details  ",
				accentColor: "  #5B7FFF  ",
				slug: "  My_Custom Schema  ",
				propertiesSchema: { title: { type: "string" } },
			}),
		).toEqual({
			icon: "book-open",
			name: "Book Details",
			slug: "my-custom-schema",
			accentColor: "#5B7FFF",
			propertiesSchema: { title: { type: "string" } },
		});
	});

	it("throws when icon is blank", () => {
		expect(() =>
			resolveEntitySchemaCreateInput({
				icon: "   ",
				name: "Books",
				accentColor: "#5B7FFF",
				propertiesSchema: { title: { type: "string" } },
			}),
		).toThrow("Entity schema icon is required");
	});

	it("throws when accent color is blank", () => {
		expect(() =>
			resolveEntitySchemaCreateInput({
				name: "Books",
				icon: "book-open",
				accentColor: "   ",
				propertiesSchema: { title: { type: "string" } },
			}),
		).toThrow("Entity schema accent color is required");
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
