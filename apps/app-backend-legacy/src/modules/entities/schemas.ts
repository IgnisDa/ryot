import { z } from "@hono/zod-openapi";

import { dataSchema, itemDataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	ImageSchema,
	nonEmptyStringSchema,
	nonEmptyTrimmedStringSchema,
	stringUnknownRecordSchema,
	timestampFields,
} from "~/lib/zod";
import { sandboxFailedResultSchema, sandboxPendingResultSchema } from "~/modules/sandbox/schemas";

export const listedEntitySchema = z.object({
	id: z.string(),
	name: z.string(),
	...timestampFields,
	entitySchemaId: z.string(),
	image: ImageSchema.nullable(),
	populatedAt: z.date().nullable(),
	externalId: z.string().nullable(),
	properties: stringUnknownRecordSchema,
	sandboxScriptId: z.string().nullable(),
});

const entityResponseSchema = itemDataSchema(listedEntitySchema);

export const getEntityResponseSchema = entityResponseSchema;

export const createEntityResponseSchema = entityResponseSchema;

export const clearEntityUserStateResponseSchema = itemDataSchema(
	z.object({
		entityId: z.string(),
		deletedEventsCount: z.number().int(),
		deletedRelationshipsCount: z.number().int(),
	}),
);

export const entityParams = createIdParamsSchema("entityId");

export const createEntityBody = z.object({
	image: ImageSchema.nullable(),
	name: nonEmptyTrimmedStringSchema,
	properties: stringUnknownRecordSchema,
	entitySchemaId: nonEmptyTrimmedStringSchema,
	externalId: nonEmptyTrimmedStringSchema.optional(),
	sandboxScriptId: nonEmptyTrimmedStringSchema.optional(),
});

export const importEntityBody = z.object({
	scriptId: nonEmptyStringSchema,
	externalId: nonEmptyStringSchema,
	entitySchemaId: nonEmptyStringSchema,
});

export const importEntityResponseSchema = dataSchema(z.object({ jobId: nonEmptyStringSchema }));

export const entityImportJobParams = createIdParamsSchema("jobId");

export const entityImportCompletedResultSchema = z.object({
	data: listedEntitySchema,
	status: z.literal("completed"),
});

export const importEntityResultResponseSchema = dataSchema(
	z.discriminatedUnion("status", [
		sandboxFailedResultSchema,
		sandboxPendingResultSchema,
		entityImportCompletedResultSchema,
	]),
);

export type ListedEntity = z.infer<typeof listedEntitySchema>;
export type ImportEntityBody = z.infer<typeof importEntityBody>;
export type CreateEntityBody = z.infer<typeof createEntityBody>;
export type ImportEntityResult = z.infer<typeof importEntityResultResponseSchema.shape.data>;
export type ClearEntityUserStateResponse = z.infer<typeof clearEntityUserStateResponseSchema>;
