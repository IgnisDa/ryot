import { describe, expect, it } from "bun:test";
import { propertySchemaInputSchema } from "./schemas";
import { parsePropertySchemaInput } from "./service";

describe("parsePropertySchemaInput", () => {
	it("parses a flat properties map", () => {
		expect(
			parsePropertySchemaInput(
				{ rating: { type: "number" } },
				{
					propertiesLabel: "Entity schema properties",
					schemaLabel: "Entity schema properties schema",
				},
			),
		).toEqual({ rating: { type: "number" } });
	});

	it("rejects an empty properties map", () => {
		expect(() =>
			parsePropertySchemaInput(
				{},
				{
					propertiesLabel: "Entity schema properties",
					schemaLabel: "Entity schema properties schema",
				},
			),
		).toThrow("Entity schema properties must contain at least one property");
	});

	it("uses the provided labels in validation messages", () => {
		expect(() =>
			parsePropertySchemaInput([], {
				propertiesLabel: "Event schema properties",
				schemaLabel: "Event schema properties schema",
			}),
		).toThrow("Event schema properties schema must be a JSON object");
	});

	it("rejects string inputs", () => {
		expect(() =>
			parsePropertySchemaInput('{"rating":{"type":"number"}}', {
				propertiesLabel: "Entity schema properties",
				schemaLabel: "Entity schema properties schema",
			}),
		).toThrow("Entity schema properties schema must be a JSON object");
	});

	it("rejects extra keys on primitive properties", () => {
		expect(() =>
			parsePropertySchemaInput(
				{ rating: { type: "number", items: {} } },
				{
					propertiesLabel: "Entity schema properties",
					schemaLabel: "Entity schema properties schema",
				},
			),
		).toThrow('Property "rating" has unsupported key "items"');
	});

	it("rejects non-literal required flag", () => {
		expect(() =>
			parsePropertySchemaInput(
				{ rating: { type: "number", required: false } },
				{
					propertiesLabel: "Entity schema properties",
					schemaLabel: "Entity schema properties schema",
				},
			),
		).toThrow('Property "rating" must have required=true when present');
	});

	it("rejects extra keys on array and object properties", () => {
		expect(() =>
			parsePropertySchemaInput(
				{
					tags: {
						type: "array",
						properties: {},
						items: { type: "string" },
					},
				},
				{
					propertiesLabel: "Entity schema properties",
					schemaLabel: "Entity schema properties schema",
				},
			),
		).toThrow('Property "tags" has unsupported key "properties"');

		expect(() =>
			parsePropertySchemaInput(
				{
					metadata: {
						items: {},
						type: "object",
						properties: { title: { type: "string" } },
					},
				},
				{
					propertiesLabel: "Entity schema properties",
					schemaLabel: "Entity schema properties schema",
				},
			),
		).toThrow('Property "metadata" has unsupported key "items"');
	});
});

describe("propertySchemaInputSchema", () => {
	it("accepts a non-empty object", () => {
		expect(
			propertySchemaInputSchema.safeParse({ rating: { type: "number" } })
				.success,
		).toBeTrue();
	});

	it("rejects strings", () => {
		expect(
			propertySchemaInputSchema.safeParse('{"rating":{"type":"number"}}')
				.success,
		).toBeFalse();
	});

	it("rejects an empty object", () => {
		const result = propertySchemaInputSchema.safeParse({});

		expect(result.success).toBeFalse();
	});
});
