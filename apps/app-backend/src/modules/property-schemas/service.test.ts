import { describe, expect, it } from "bun:test";
import { createOptionalRatingPropertiesSchema } from "~/lib/test-fixtures";
import { parsePropertySchemaInput } from "./service";

describe("parsePropertySchemaInput", () => {
	it("parses a flat properties map", () => {
		const schema = createOptionalRatingPropertiesSchema();

		expect(
			parsePropertySchemaInput(schema, {
				propertiesLabel: "Entity schema properties",
			}),
		).toEqual(schema);
	});

	it("rejects an empty properties map", () => {
		expect(() =>
			parsePropertySchemaInput(
				{ fields: {} },
				{ propertiesLabel: "Entity schema properties" },
			),
		).toThrow("Entity schema properties must contain at least one property");
	});

	it("uses the provided labels in validation messages", () => {
		expect(() =>
			parsePropertySchemaInput([], {
				propertiesLabel: "Event schema properties",
			}),
		).toThrow("Invalid input: expected object, received array");
	});

	it("rejects string inputs", () => {
		expect(() =>
			parsePropertySchemaInput('{"rating":{"type":"number"}}', {
				propertiesLabel: "Entity schema properties",
			}),
		).toThrow("Invalid input: expected object, received string");
	});

	it("rejects extra keys on primitive properties", () => {
		expect(() =>
			parsePropertySchemaInput(
				{
					fields: {
						rating: {
							...createOptionalRatingPropertiesSchema().fields.rating,
							items: {},
						},
					},
				},
				{ propertiesLabel: "Entity schema properties" },
			),
		).toThrow('Unrecognized key: "items"');
	});

	it("rejects non-literal required flag", () => {
		expect(() =>
			parsePropertySchemaInput(
				{
					fields: {
						rating: {
							...createOptionalRatingPropertiesSchema().fields.rating,
							validation: { required: false },
						},
					},
				},
				{ propertiesLabel: "Entity schema properties" },
			),
		).toThrow("Invalid input: expected true");
	});

	it("rejects extra keys on array and object properties", () => {
		expect(() =>
			parsePropertySchemaInput(
				{
					fields: {
						tags: { type: "array", properties: {}, items: { type: "string" } },
					},
				},
				{ propertiesLabel: "Entity schema properties" },
			),
		).toThrow('Unrecognized key: "properties"');

		expect(() =>
			parsePropertySchemaInput(
				{
					fields: {
						metadata: {
							items: {},
							type: "object",
							properties: { title: { type: "string" } },
						},
					},
				},
				{ propertiesLabel: "Entity schema properties" },
			),
		).toThrow('Unrecognized key: "items"');
	});
});
