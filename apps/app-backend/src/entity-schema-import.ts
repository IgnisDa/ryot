import { z } from "zod";

const schemaImportPerson = z
	.object({ role: z.string(), source: z.string(), identifier: z.string() })
	.strict();

export const schemaImportResponse = z
	.object({
		name: z.string(),
		external_ids: z.object({ openlibrary_work: z.string() }).strict(),
		properties: z
			.object({
				source_url: z.string(),
				pages: z.number().int().nullable(),
				description: z.string().nullable(),
				genres: z.array(z.string()),
				publish_year: z.number().int().nullable(),
				people: z.array(schemaImportPerson),
				assets: z.object({ remote_images: z.array(z.string()) }).strict(),
			})
			.strict(),
	})
	.strict();

export type SchemaImportResponse = z.infer<typeof schemaImportResponse>;
