import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";

export const listedEntitySchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	entitySchemaId: z.string(),
	externalId: z.string().nullable(),
	detailsSandboxScriptId: z.string().nullable(),
	properties: z.record(z.string(), z.unknown()),
});

export const listEntitiesResponseSchema = dataSchema(
	z.array(listedEntitySchema),
);

export const getEntityResponseSchema = dataSchema(listedEntitySchema);

export const createEntityResponseSchema = dataSchema(listedEntitySchema);

export const entityParams = z.object({
	entityId: nonEmptyTrimmedStringSchema,
});

export const listEntitiesQuery = z.object({
	entitySchemaId: nonEmptyTrimmedStringSchema,
});

export const createEntityBody = z.object({
	name: nonEmptyTrimmedStringSchema,
	entitySchemaId: nonEmptyTrimmedStringSchema,
	properties: z.record(z.string(), z.unknown()),
});

export type CreateEntityBody = z.infer<typeof createEntityBody>;
