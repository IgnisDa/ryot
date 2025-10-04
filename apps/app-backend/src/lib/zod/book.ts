import { z } from "zod";
import {
	createImportEnvelopeSchema,
	nullableIntSchema,
	toStableJsonSchema,
} from "./base";
import { mediaPropertiesSchema } from "./media";

const schemaImportPerson = z
	.object({ role: z.string(), source: z.string(), identifier: z.string() })
	.strict();

export const bookPropertiesSchema = mediaPropertiesSchema.extend({
	source_url: z.string(),
	pages: nullableIntSchema,
	isCompilation: z.boolean().optional(),
	people: z.array(schemaImportPerson),
});

export const bookPropertiesJsonSchema =
	toStableJsonSchema(bookPropertiesSchema);

export const schemaImportResponse =
	createImportEnvelopeSchema(bookPropertiesSchema);

export type SchemaImportResponse = z.infer<typeof schemaImportResponse>;
