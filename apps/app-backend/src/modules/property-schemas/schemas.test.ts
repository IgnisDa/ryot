import { describe, expect, it } from "bun:test";
import { createNestedPeoplePropertySchema } from "~/lib/test-fixtures";
import {
	createPropertySchemaObjectSchema,
	propertySchemaObjectSchema,
} from "./schemas";

describe("propertySchemaObjectSchema", () => {
	it("rejects property definitions without a type", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: { title: { validation: { required: true } } },
		});

		expect(result.success).toBeFalse();
	});

	it("accepts nested array and object property definitions", () => {
		const result = propertySchemaObjectSchema.safeParse(
			createNestedPeoplePropertySchema(),
		);

		expect(result.success).toBeTrue();
	});

	it("accepts validation and transform metadata on numeric properties", () => {
		const result = propertySchemaObjectSchema.safeParse({
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
		});

		expect(result.success).toBeTrue();
	});

	it("rejects contradictory numeric bounds", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: {
				progressPercent: {
					type: "number",
					validation: { maximum: 5, exclusiveMinimum: 10 },
				},
			},
		});

		expect(result.success).toBeFalse();
	});

	it("accepts conditional rules that reference existing primitive fields", () => {
		const result = propertySchemaObjectSchema.safeParse({
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
		});

		expect(result.success).toBeTrue();
	});

	it("accepts built-in complete-style datetime rules with constrained modes", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: {
				startedOn: { type: "datetime" },
				completedOn: { type: "datetime" },
				completionMode: {
					type: "string",
					validation: {
						required: true,
						pattern: "^(just_now|unknown|custom_timestamps)$",
					},
				},
			},
			rules: [
				{
					kind: "validation",
					path: ["completedOn"],
					validation: { required: true },
					when: {
						operator: "eq",
						path: ["completionMode"],
						value: "custom_timestamps",
					},
				},
			],
		});

		expect(result.success).toBeTrue();
	});

	it("rejects rules that point at missing fields", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: { status: { type: "string" } },
			rules: [
				{
					kind: "validation",
					path: ["progressPercent"],
					validation: { required: true },
					when: { operator: "eq", path: ["status"], value: "completed" },
				},
			],
		});

		expect(result.success).toBeFalse();
	});

	it("rejects rules whose condition values do not match field types", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: { status: { type: "string" }, rating: { type: "integer" } },
			rules: [
				{
					path: ["rating"],
					kind: "validation",
					validation: { required: true },
					when: { value: 10, operator: "eq", path: ["status"] },
				},
			],
		});

		expect(result.success).toBeFalse();
	});

	it("accepts object properties with unknownKeys strip policy", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: {
				membershipPropertiesSchema: {
					properties: {},
					type: "object",
					unknownKeys: "strip",
				},
			},
		});

		expect(result.success).toBeTrue();
	});

	it("accepts object properties with unknownKeys strict policy", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: {
				config: {
					type: "object",
					unknownKeys: "strict",
					properties: { enabled: { type: "boolean" } },
				},
			},
		});

		expect(result.success).toBeTrue();
	});

	it("accepts object properties without unknownKeys (defaults to strict)", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: {
				config: { type: "object", properties: { name: { type: "string" } } },
			},
		});

		expect(result.success).toBeTrue();
	});
});

describe("createPropertySchemaObjectSchema", () => {
	it("uses the provided empty-object message", () => {
		const schema = createPropertySchemaObjectSchema(
			"Event schema properties must contain at least one property",
		);
		const result = schema.safeParse({ fields: {} });

		expect(result.success).toBeFalse();
		if (result.success) {
			return;
		}

		expect(result.error.issues[0]?.message).toBe(
			"Event schema properties must contain at least one property",
		);
	});
});
