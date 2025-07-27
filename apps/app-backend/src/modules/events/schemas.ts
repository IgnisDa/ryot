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
	sessionEntityId: z.string().nullable(),
});

export const listEventsResponseSchema = listDataSchema(listedEventSchema);

export const createEventBulkResponseSchema = itemDataSchema(
	z.object({ count: z.number().int() }),
);

export const listEventsQuery = z
	.object({
		entityId: nonEmptyTrimmedStringSchema.optional(),
		sessionEntityId: nonEmptyTrimmedStringSchema.optional(),
		eventSchemaSlug: nonEmptyTrimmedStringSchema.optional(),
	})
	.refine(
		(query) =>
			query.entityId !== undefined || query.sessionEntityId !== undefined,
		"Either entityId or sessionEntityId is required",
	);

export const createEventBody = z.object({
	properties: unknownObjectSchema,
	entityId: nonEmptyTrimmedStringSchema,
	eventSchemaId: nonEmptyTrimmedStringSchema,
	sessionEntityId: nonEmptyTrimmedStringSchema.optional(),
});

export const createEventBulkBody = z.array(createEventBody);

export type ListedEvent = z.infer<typeof listedEventSchema>;
export type CreateEventBody = z.infer<typeof createEventBody>;
export type CreateEventBulkBody = z.infer<typeof createEventBulkBody>;
