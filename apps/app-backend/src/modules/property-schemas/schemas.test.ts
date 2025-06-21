import { describe, expect, it } from "bun:test";
import {
	createPropertySchemaObjectSchema,
	propertySchemaObjectSchema,
} from "./schemas";

describe("propertySchemaObjectSchema", () => {
	it("rejects contradictory numeric bounds", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: {
				progressPercent: {
					label: "Progress Percent",
					type: "number",
					validation: { maximum: 5, exclusiveMinimum: 10 },
				},
			},
		});

		expect(result.success).toBeFalse();
	});

	it("rejects rules that point at missing fields", () => {
		const result = propertySchemaObjectSchema.safeParse({
			fields: { status: { label: "Status", type: "string" } },
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
			fields: {
				status: { label: "Status", type: "string" },
				rating: { label: "Rating", type: "integer" },
			},
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
