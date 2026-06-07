import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

const measurementStatisticSchema = z.object({
	value: z.number().describe("Numeric value of this statistic"),
	label: z.string().describe("Human-readable label as it appears in the source"),
	key: z.string().describe("Normalized snake_case identifier for this statistic"),
});

const measurementPropertiesSchema = z
	.object({
		comment: z.string().nullish().describe("Optional notes about this measurement"),
		recordedAt: z.iso.datetime().describe("Date and time this measurement was recorded"),
		statistics: z.array(measurementStatisticSchema).describe("Array of measurement statistics"),
	})
	.strict();

export const measurementPropertiesJsonSchema = toAppSchemaProperties(measurementPropertiesSchema);
