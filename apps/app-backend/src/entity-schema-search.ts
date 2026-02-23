import { z } from "zod";

export const entitySchemaSearchJobName = "entity-schema-search";

export const schemaSearchResponse = z.object({
	details: z.object({
		total_items: z.number().int().nonnegative(),
		next_page: z.number().int().min(1).nullable(),
	}),
	items: z.array(
		z.object({
			title: z.string(),
			identifier: z.string(),
			image: z.string().nullable().optional(),
			publish_year: z.number().int().nullable().optional(),
		}),
	),
});

export type SchemaSearchResponse = z.infer<typeof schemaSearchResponse>;

export const entitySchemaSearchJobData = z.object({
	page: z.number().int().min(1),
	query: z.string().trim().min(1),
	userId: z.string().trim().min(1),
	schemaSlug: z.string().trim().min(1),
	scriptCode: z.string().trim().min(1),
});

export type EntitySchemaSearchJobData = z.infer<
	typeof entitySchemaSearchJobData
>;
