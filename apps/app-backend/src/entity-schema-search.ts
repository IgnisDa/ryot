import { z } from "zod";

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
