import { z } from "zod";
import {
	createImportEnvelopeSchema,
	nullableBooleanSchema,
	nullableIntSchema,
	toStableJsonSchema,
} from "./base";
import { mediaPropertiesSchema } from "./media";

const schemaImportPerson = z
	.object({ role: z.string(), source: z.string(), identifier: z.string() })
	.strict();

export const bookPropertiesSchema = mediaPropertiesSchema.extend({
	pages: nullableIntSchema,
	isCompilation: nullableBooleanSchema,
	people: z.array(schemaImportPerson),
});

export const bookPropertiesJsonSchema =
	toStableJsonSchema(bookPropertiesSchema);

export const schemaImportResponse =
	createImportEnvelopeSchema(bookPropertiesSchema);

export type SchemaImportResponse = z.infer<typeof schemaImportResponse>;

export const readEventPropertiesSchema = z
	.object({
		finishedAt: z.iso.datetime().nullish(),
		numberOfProgressEvents: nullableIntSchema,
		platforms: z.array(z.string()).nullish(),
	})
	.strict();

export const progressEventPropertiesSchema = z
	.object({
		platforms: z.array(z.string()).nullish(),
		progressPercent: z.number().min(0).max(100),
	})
	.strict();

export const readEventPropertiesJsonSchema = toStableJsonSchema(
	readEventPropertiesSchema,
);

export const progressEventPropertiesJsonSchema = toStableJsonSchema(
	progressEventPropertiesSchema,
);
