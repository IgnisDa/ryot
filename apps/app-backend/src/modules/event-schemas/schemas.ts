import { z } from "zod";

const listedEventSchemaItem = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	entitySchemaName: z.string(),
});

export const listEventSchemasResponse = z.array(listedEventSchemaItem);

export type ListedEventSchemaItem = z.infer<typeof listedEventSchemaItem>;
