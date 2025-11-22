import { z } from "zod";
import { dataSchema, unknownObjectSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";
import { occurredAtStringSchema } from "./service";

export const listedEventSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	occurredAt: z.date(),
	entityId: z.string(),
	eventSchemaId: z.string(),
	eventSchemaName: z.string(),
	eventSchemaSlug: z.string(),
	properties: unknownObjectSchema,
});

export const listEventsResponseSchema = dataSchema(z.array(listedEventSchema));

export const createEventResponseSchema = dataSchema(listedEventSchema);

export const listEventsQuery = z.object({
	entityId: nonEmptyTrimmedStringSchema,
});

export const createEventBody = z.object({
	properties: unknownObjectSchema,
	occurredAt: occurredAtStringSchema,
	entityId: nonEmptyTrimmedStringSchema,
	eventSchemaId: nonEmptyTrimmedStringSchema,
});

export type CreateEventBody = z.infer<typeof createEventBody>;
export type ListedEvent = z.infer<typeof listedEventSchema>;
