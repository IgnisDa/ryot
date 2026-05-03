import { z } from "@hono/zod-openapi";

import { itemDataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	ImageSchema,
	nonEmptyTrimmedStringSchema,
	stringUnknownRecordSchema,
	timestampFields,
} from "~/lib/zod";

export const listedEntitySchema = z.object({
	id: z.string(),
	name: z.string(),
	...timestampFields,
	populatedAt: z.date(),
	entitySchemaId: z.string(),
	image: ImageSchema.nullable(),
	externalId: z.string().nullable(),
	properties: stringUnknownRecordSchema,
	sandboxScriptId: z.string().nullable(),
});

const entityResponseSchema = itemDataSchema(listedEntitySchema);

export const getEntityResponseSchema = entityResponseSchema;

export const createEntityResponseSchema = entityResponseSchema;

export const entityParams = createIdParamsSchema("entityId");

export const createEntityBody = z.object({
	image: ImageSchema.nullable(),
	name: nonEmptyTrimmedStringSchema,
	properties: stringUnknownRecordSchema,
	entitySchemaId: nonEmptyTrimmedStringSchema,
	externalId: nonEmptyTrimmedStringSchema.optional(),
	sandboxScriptId: nonEmptyTrimmedStringSchema.optional(),
});

export type CreateEntityBody = z.infer<typeof createEntityBody>;
export type ListedEntity = z.infer<typeof listedEntitySchema>;
