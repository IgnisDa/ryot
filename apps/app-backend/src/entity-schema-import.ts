import { toJSONSchema, z } from "zod";

const schemaImportPerson = z
	.object({ role: z.string(), source: z.string(), identifier: z.string() })
	.strict();

export const bookPropertiesSchema = z
	.object({
		source_url: z.string(),
		pages: z.number().int().nullable(),
		description: z.string().nullable(),
		genres: z.array(z.string()),
		isCompilation: z.boolean().optional(),
		publish_year: z.number().int().nullable(),
		people: z.array(schemaImportPerson),
		assets: z.object({ remote_images: z.array(z.string()) }).strict(),
	})
	.strict();

export const bookPropertiesJsonSchema = JSON.parse(
	JSON.stringify(toJSONSchema(bookPropertiesSchema)),
);

export const schemaImportResponse = z
	.object({
		name: z.string(),
		properties: bookPropertiesSchema,
		external_ids: z.object({ openlibrary_work: z.string() }).strict(),
	})
	.strict();

export type SchemaImportResponse = z.infer<typeof schemaImportResponse>;
