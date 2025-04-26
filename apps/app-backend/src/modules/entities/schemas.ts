import { z } from "zod";
import { ImageSchema } from "~/lib/db/schema";
import { itemDataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";

export const listedEntitySchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	entitySchemaId: z.string(),
	externalId: z.string().nullable(),
	image: ImageSchema.nullable(),
	detailsSandboxScriptId: z.string().nullable(),
	properties: z.record(z.string(), z.unknown()),
});

const entityResponseSchema = itemDataSchema(listedEntitySchema);

export const getEntityResponseSchema = entityResponseSchema;

export const createEntityResponseSchema = entityResponseSchema;

export const entityParams = createIdParamsSchema("entityId");

export const createEntityBody = z.object({
	image: ImageSchema.nullable(),
	name: nonEmptyTrimmedStringSchema,
	entitySchemaId: nonEmptyTrimmedStringSchema,
	properties: z.record(z.string(), z.unknown()),
});

export type CreateEntityBody = z.infer<typeof createEntityBody>;
export type ListedEntity = z.infer<typeof listedEntitySchema>;
