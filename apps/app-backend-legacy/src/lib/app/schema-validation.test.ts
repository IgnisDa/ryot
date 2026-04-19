import { describe, expect, it } from "bun:test";

import { createNoteAndRatingPropertiesSchema } from "~/lib/test-fixtures";

import { parseAppSchemaProperties } from "./schema-validation";

describe("parseAppSchemaProperties", () => {
	it("validates properties against the provided app schema", () => {
		const propertiesSchema = createNoteAndRatingPropertiesSchema();

		expect(
			parseAppSchemaProperties({
				kind: "Event",
				propertiesSchema,
				properties: { note: "Great tasting", rating: 4.5 },
			}),
		).toEqual({ note: "Great tasting", rating: 4.5 });
	});

	it("rejects invalid properties with a kind-specific error", () => {
		expect(() =>
			parseAppSchemaProperties({
				kind: "Entity",
				properties: { rating: "bad" },
				propertiesSchema: {
					fields: {
						rating: createNoteAndRatingPropertiesSchema().fields.rating,
					},
				},
			}),
		).toThrow("Entity payload is invalid");
	});

	it("rejects unknown properties not declared in the schema", () => {
		expect(() =>
			parseAppSchemaProperties({
				kind: "Event",
				properties: { extra: true },
				propertiesSchema: { fields: {} },
			}),
		).toThrow("Event payload is invalid");
	});

	it("applies schema transforms before returning parsed data", () => {
		expect(
			parseAppSchemaProperties({
				kind: "Event",
				properties: { progressPercent: 25.555 },
				propertiesSchema: {
					fields: {
						progressPercent: {
							type: "number",
							label: "Progress Percent",
							description: "Progress percentage",
							transform: { round: { mode: "half_up", scale: 2 } },
							validation: {
								required: true,
								exclusiveMinimum: 0,
								exclusiveMaximum: 100,
							},
						},
					},
				},
			}),
		).toEqual({ progressPercent: 25.56 });
	});

	it("fills in defaultValue when the field is absent from properties", () => {
		expect(
			parseAppSchemaProperties({
				kind: "Event",
				properties: {},
				propertiesSchema: {
					fields: {
						source: {
							type: "string",
							label: "Source",
							description: "Source",
							defaultValue: "manual",
						},
					},
				},
			}),
		).toEqual({ source: "manual" });
	});

	it("does not override an explicit value with defaultValue", () => {
		expect(
			parseAppSchemaProperties({
				kind: "Event",
				properties: { source: "import" },
				propertiesSchema: {
					fields: {
						source: {
							type: "string",
							label: "Source",
							description: "Source",
							defaultValue: "manual",
						},
					},
				},
			}),
		).toEqual({ source: "import" });
	});

	it("applies defaultValue for a required field when the field is absent", () => {
		expect(
			parseAppSchemaProperties({
				kind: "Entity",
				properties: {},
				propertiesSchema: {
					fields: {
						status: {
							type: "string",
							label: "Status",
							description: "Status",
							defaultValue: "active",
							validation: { required: true },
						},
					},
				},
			}),
		).toEqual({ status: "active" });
	});

	it("applies conditional required rules after field parsing", () => {
		expect(
			parseAppSchemaProperties({
				kind: "Entity",
				properties: { status: "draft" },
				propertiesSchema: {
					fields: {
						progressPercent: {
							type: "number",
							label: "Progress Percent",
							description: "Progress percentage",
						},
						status: {
							type: "string",
							label: "Status",
							validation: { required: true },
							description: "Workflow status",
						},
					},
					rules: [
						{
							kind: "validation",
							path: ["progressPercent"],
							validation: { required: true },
							when: { operator: "eq", path: ["status"], value: "completed" },
						},
					],
				},
			}),
		).toEqual({ status: "draft" });

		expect(() =>
			parseAppSchemaProperties({
				kind: "Entity",
				properties: { status: "completed" },
				propertiesSchema: {
					fields: {
						progressPercent: {
							type: "number",
							label: "Progress Percent",
							description: "Progress percentage",
						},
						status: {
							type: "string",
							label: "Status",
							validation: { required: true },
							description: "Workflow status",
						},
					},
					rules: [
						{
							kind: "validation",
							path: ["progressPercent"],
							validation: { required: true },
							when: { operator: "eq", path: ["status"], value: "completed" },
						},
					],
				},
			}),
		).toThrow("Entity payload is invalid");
	});
});
