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
