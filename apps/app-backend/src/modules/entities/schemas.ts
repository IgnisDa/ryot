import { z } from "@hono/zod-openapi";
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

export const createEntityWithCollectionBody = createEntityBody.extend({
	collectionId: z.string(),
	membershipProperties: stringUnknownRecordSchema.optional(),
});

const membershipRelationshipSchema = z.object({
	id: z.string(),
	relType: z.string(),
	createdAt: z.string(),
	sourceEntityId: z.string(),
	targetEntityId: z.string(),
	properties: stringUnknownRecordSchema,
});

const membershipDataSchema = z.object({
	collection: membershipRelationshipSchema,
	memberOf: membershipRelationshipSchema,
});

export const createEntityWithCollectionDataSchema = z.object({
	entity: listedEntitySchema,
	membership: membershipDataSchema,
});

export const createEntityWithCollectionResponseSchema = itemDataSchema(
	createEntityWithCollectionDataSchema,
);

export type CreateEntityBody = z.infer<typeof createEntityBody>;
export type ListedEntity = z.infer<typeof listedEntitySchema>;
export type CreateEntityWithCollectionBody = z.infer<
	typeof createEntityWithCollectionBody
>;
