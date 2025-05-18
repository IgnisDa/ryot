import { describe, expect, it } from "bun:test";
import {
	createCompletePropertiesSchema,
	createNoteAndRatingPropertiesSchema,
} from "~/lib/test-fixtures";
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
		).toThrow("Entity properties validation failed");
	});

	it("rejects unknown properties not declared in the schema", () => {
		expect(() =>
			parseAppSchemaProperties({
				kind: "Event",
				properties: { extra: true },
				propertiesSchema: { fields: {} },
			}),
		).toThrow("Event properties validation failed");
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

	it("rejects values that fail schema range validation", () => {
		expect(() =>
			parseAppSchemaProperties({
				kind: "Event",
				properties: { rating: 6 },
				propertiesSchema: {
					fields: {
						rating: {
							type: "integer",
							validation: { required: true, maximum: 5, minimum: 1 },
						},
					},
				},
			}),
		).toThrow("Event properties validation failed");
	});

	it("applies conditional required rules after field parsing", () => {
		expect(
			parseAppSchemaProperties({
				kind: "Entity",
				properties: { status: "draft" },
				propertiesSchema: {
					fields: {
						progressPercent: { type: "number" },
						status: { type: "string", validation: { required: true } },
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
						progressPercent: { type: "number" },
						status: { type: "string", validation: { required: true } },
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
		).toThrow("Entity properties validation failed");
	});

	it("validates complete event metadata with conditional custom timestamps", () => {
		const propertiesSchema = createCompletePropertiesSchema();

		expect(
			parseAppSchemaProperties({
				kind: "Event",
				propertiesSchema,
				properties: { completionMode: "just_now" },
			}),
		).toEqual({ completionMode: "just_now" });

		expect(
			parseAppSchemaProperties({
				kind: "Event",
				propertiesSchema,
				properties: {
					completionMode: "custom_timestamps",
					startedOn: "2026-03-20T12:00:00Z",
					completedOn: "2026-03-27T18:30:00Z",
				},
			}),
		).toEqual({
			completionMode: "custom_timestamps",
			startedOn: "2026-03-20T12:00:00Z",
			completedOn: "2026-03-27T18:30:00Z",
		});

		expect(() =>
			parseAppSchemaProperties({
				kind: "Event",
				propertiesSchema,
				properties: { completionMode: "custom_timestamps" },
			}),
		).toThrow("Event properties validation failed");

		expect(() =>
			parseAppSchemaProperties({
				kind: "Event",
				propertiesSchema,
				properties: { completionMode: "later" },
			}),
		).toThrow("Event properties validation failed");

		expect(() =>
			parseAppSchemaProperties({
				kind: "Event",
				propertiesSchema,
				properties: {
					completedOn: "2026-03-27",
					completionMode: "custom_timestamps",
				},
			}),
		).toThrow("Event properties validation failed");
	});
});
