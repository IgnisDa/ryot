import { z } from "@hono/zod-openapi";
import {
	itemDataSchema,
	listDataSchema,
	unknownObjectSchema,
} from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema, timestampFields } from "~/lib/zod";

export const listedEventSchema = z.object({
	id: z.string(),
	...timestampFields,
	entityId: z.string(),
	eventSchemaId: z.string(),
	eventSchemaName: z.string(),
	eventSchemaSlug: z.string(),
	properties: unknownObjectSchema,
});

export const listEventsResponseSchema = listDataSchema(listedEventSchema);

export const createEventBulkResponseSchema = itemDataSchema(
	z.object({ count: z.number().int() }),
);

export const listEventsQuery = z.object({
	entityId: nonEmptyTrimmedStringSchema,
	eventSchemaSlug: nonEmptyTrimmedStringSchema.optional(),
});

export const createEventBody = z.object({
	properties: unknownObjectSchema,
	entityId: nonEmptyTrimmedStringSchema,
	eventSchemaId: nonEmptyTrimmedStringSchema,
});

export const createEventBulkBody = z.array(createEventBody);

export type ListedEvent = z.infer<typeof listedEventSchema>;
export type CreateEventBody = z.infer<typeof createEventBody>;
export type CreateEventBulkBody = z.infer<typeof createEventBulkBody>;
