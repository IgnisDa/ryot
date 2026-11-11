import { describe, expect, it } from "bun:test";

import { appSchemaJsonSchema } from "./app-schema-json-schema";

describe("AppSchema JSON Schema", () => {
	it("represents bounds, choices, defaults, nested objects and strict keys", () => {
		const converted = appSchemaJsonSchema({
			unknownKeys: "strict",
			fields: {
				count: {
					label: "Count",
					type: "integer",
					defaultValue: 4,
					description: "Result count",
					validation: { minimum: 1, maximum: 10, required: true },
				},
				states: {
					label: "States",
					type: "enum-array",
					validation: { minItems: 1 },
					description: "Selected states",
					choices: { kind: "static", values: [{ value: "open" }, { value: "closed" }] },
				},
				range: {
					type: "object",
					label: "Range",
					unknownKeys: "strict",
					description: "Date range",
					properties: {
						start: {
							type: "date",
							label: "Start",
							description: "Start date",
							validation: { required: true },
						},
					},
				},
			},
		});
		expect(converted).toMatchObject({
			required: [],
			type: "object",
			additionalProperties: false,
			properties: {
				count: { default: 4, minimum: 1, maximum: 10, type: "integer" },
				states: {
					anyOf: [
						{ minItems: 1, type: "array", items: { enum: ["open", "closed"] } },
						{ type: "null" },
					],
				},
				range: {
					anyOf: [
						{
							type: "object",
							required: ["start"],
							additionalProperties: false,
							properties: { start: { type: "string", format: "date" } },
						},
						{ type: "null" },
					],
				},
			},
		});
	});
	it("represents conditional requirements and visibility and refuses unresolved choices", () => {
		const text = { type: "string", label: "Value", description: "Value" } as const;
		const converted = appSchemaJsonSchema({
			fields: { mode: text, value: text },
			rules: [
				{
					path: ["value"],
					kind: "validation",
					validation: { required: true },
					when: { operator: "eq", path: ["mode"], value: "required" },
				},
				{
					path: ["value"],
					kind: "visibility",
					visibility: { hidden: true },
					when: { path: ["mode"], operator: "not_exists" },
				},
			],
		});
		expect(converted["allOf"]).toEqual([
			{
				anyOf: [
					{
						not: {
							type: "object",
							required: ["mode"],
							properties: { mode: { enum: ["required"] } },
						},
					},
					{ type: "object", required: ["value"], properties: { value: { not: { enum: [null] } } } },
				],
			},
			{
				anyOf: [
					{
						not: {
							not: {
								type: "object",
								required: ["mode"],
								properties: { mode: { not: { enum: [null] } } },
							},
						},
					},
					{ not: { type: "object", required: ["value"], properties: { value: {} } } },
				],
			},
		]);
		expect(() =>
			appSchemaJsonSchema({
				fields: {
					mode: { ...text, type: "enum", choices: { kind: "dynamic", source: "choices" } },
				},
			}),
		).toThrow("Materialize dynamic choices");
	});
});
