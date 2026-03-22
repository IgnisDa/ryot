import { z } from "zod";
import {
	itemDataSchema,
	listDataSchema,
	unknownObjectSchema,
} from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema, timestampFields } from "~/lib/zod/base";
import { occurredAtStringSchema } from "./service";

export const listedEventSchema = z.object({
	id: z.string(),
	...timestampFields,
	occurredAt: z.date(),
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
});

export const createEventBody = z.object({
	properties: unknownObjectSchema,
	occurredAt: occurredAtStringSchema,
	entityId: nonEmptyTrimmedStringSchema,
	eventSchemaId: nonEmptyTrimmedStringSchema,
});

export const createEventBulkBody = z.array(createEventBody);

export type ListedEvent = z.infer<typeof listedEventSchema>;
export type CreateEventBody = z.infer<typeof createEventBody>;
export type CreateEventBulkBody = z.infer<typeof createEventBulkBody>;
