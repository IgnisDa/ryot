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
							label: "Progress Percent",
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
							label: "Rating",
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
						progressPercent: { type: "number", label: "Progress Percent" },
						status: {
							type: "string",
							label: "Status",
							validation: { required: true },
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
						progressPercent: { type: "number", label: "Progress Percent" },
						status: {
							type: "string",
							label: "Status",
							validation: { required: true },
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

	it("accepts null and undefined for non-required fields", () => {
		const schema = {
			fields: {
				title: { label: "Title", type: "string" as const },
				score: { label: "Score", type: "number" as const },
				count: { label: "Count", type: "integer" as const },
				createdAt: { label: "Created At", type: "date" as const },
				isActive: { label: "Is Active", type: "boolean" as const },
				updatedAt: { label: "Updated At", type: "datetime" as const },
				tags: {
					label: "Tags",
					type: "array" as const,
					items: { label: "Item", type: "string" as const },
				},
			},
		};

		expect(
			parseAppSchemaProperties({
				kind: "Entity",
				propertiesSchema: schema,
				properties: {
					tags: null,
					title: null,
					score: null,
					count: null,
					isActive: null,
					createdAt: null,
					updatedAt: null,
				},
			}),
		).toEqual({
			tags: null,
			title: null,
			score: null,
			count: null,
			isActive: null,
			createdAt: null,
			updatedAt: null,
		});

		expect(
			parseAppSchemaProperties({
				kind: "Entity",
				properties: {},
				propertiesSchema: schema,
			}),
		).toEqual({});
	});

	it("rejects null for required fields", () => {
		const schema = {
			fields: {
				title: {
					label: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
				isActive: {
					label: "Is Active",
					type: "boolean" as const,
					validation: { required: true as const },
				},
				score: {
					label: "Score",
					type: "number" as const,
					validation: { required: true as const },
				},
				tags: {
					label: "Tags",
					type: "array" as const,
					items: { label: "Item", type: "string" as const },
					validation: { required: true as const },
				},
			},
		};

		expect(() =>
			parseAppSchemaProperties({
				kind: "Entity",
				propertiesSchema: schema,
				properties: { title: null },
			}),
		).toThrow("Entity properties validation failed");

		expect(() =>
			parseAppSchemaProperties({
				kind: "Entity",
				propertiesSchema: schema,
				properties: { isActive: null },
			}),
		).toThrow("Entity properties validation failed");

		expect(() =>
			parseAppSchemaProperties({
				kind: "Entity",
				propertiesSchema: schema,
				properties: { score: null },
			}),
		).toThrow("Entity properties validation failed");

		expect(() =>
			parseAppSchemaProperties({
				kind: "Entity",
				propertiesSchema: schema,
				properties: { tags: null },
			}),
		).toThrow("Entity properties validation failed");
	});
});
