import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";

const measurementPropertiesSchema = z
	.object({
		recordedAt: z.iso
			.datetime()
			.describe("Date and time this measurement was recorded"),
		weight: z
			.number()
			.nullish()
			.describe("Body weight in the user's preferred unit"),
		comment: z
			.string()
			.nullish()
			.describe("Optional notes about this measurement"),
	})
	.strict();

export const measurementPropertiesJsonSchema = toAppSchemaProperties(
	measurementPropertiesSchema,
);
