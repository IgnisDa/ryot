import { describe, expect, it } from "bun:test";
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
		).toThrow("Invalid input: expected record, received array");
	});

	it("rejects string inputs", () => {
		expect(() =>
			parsePropertySchemaInput('{"rating":{"type":"number"}}', {
				propertiesLabel: "Entity schema properties",
				schemaLabel: "Entity schema properties schema",
			}),
		).toThrow("Invalid input: expected record, received string");
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
		).toThrow('Unrecognized key: "items"');
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
		).toThrow("Invalid input: expected true");
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
		).toThrow('Unrecognized key: "properties"');

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
		).toThrow('Unrecognized key: "items"');
	});
});
