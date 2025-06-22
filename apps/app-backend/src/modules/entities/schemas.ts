import { z } from "zod";
import { ImageSchema } from "~/lib/db/schema";
import { itemDataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	nonEmptyTrimmedStringSchema,
	stringUnknownRecordSchema,
	timestampFields,
} from "~/lib/zod/base";

export const listedEntitySchema = z.object({
	id: z.string(),
	name: z.string(),
	...timestampFields,
	entitySchemaId: z.string(),
	image: ImageSchema.nullable(),
	externalId: z.string().nullable(),
	detailsSandboxScriptId: z.string().nullable(),
	properties: stringUnknownRecordSchema,
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
});

export type CreateEntityBody = z.infer<typeof createEntityBody>;
export type ListedEntity = z.infer<typeof listedEntitySchema>;
