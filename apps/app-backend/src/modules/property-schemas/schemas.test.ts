import { describe, expect, it } from "bun:test";
import {
	createPropertySchemaObjectSchema,
	propertySchemaObjectSchema,
} from "./schemas";

describe("propertySchemaObjectSchema", () => {
	it("rejects property definitions without a type", () => {
		const result = propertySchemaObjectSchema.safeParse({
			title: { required: true },
		});

		expect(result.success).toBeFalse();
	});

	it("accepts nested array and object property definitions", () => {
		const result = propertySchemaObjectSchema.safeParse({
			people: {
				type: "array",
				items: {
					type: "object",
					properties: {
						role: { type: "string", required: true },
					},
				},
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
		const result = schema.safeParse({});

		expect(result.success).toBeFalse();
		if (result.success) {
			return;
		}

		expect(result.error.issues[0]?.message).toBe(
			"Event schema properties must contain at least one property",
		);
	});
});
