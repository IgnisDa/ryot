import { z } from "zod";
import {
	nonEmptyTrimmedStringSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod/base";

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

export const createEventBody = z.object({
	entityId: nonEmptyTrimmedStringSchema,
	occurredAt: z.coerce.date().optional(),
	properties: stringUnknownRecordSchema.default({}),
	sessionEntityId: nonEmptyTrimmedStringSchema.optional(),
});

export const createEventParams = z.object({
	eventSchemaId: nonEmptyTrimmedStringSchema,
});

export const createEventResponse = z.object({
	eventId: z.string(),
});
export type CreateEventBody = z.infer<typeof createEventBody>;
