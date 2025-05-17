import { z } from "@hono/zod-openapi";
import { ImageSchema } from "~/lib/db/schema";
import { itemDataSchema } from "~/lib/openapi";
import {
	nonEmptyTrimmedStringSchema,
	stringUnknownRecordSchema,
	timestampFields,
} from "~/lib/zod/base";
import { propertySchemaInputSchema } from "../property-schemas/schemas";

export const addToCollectionBody = z.object({
	collectionId: z.string(),
	entityId: z.string(),
	properties: stringUnknownRecordSchema.optional(),
});

export const removeFromCollectionBody = z.object({
	collectionId: z.string(),
	entityId: z.string(),
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

export const addToCollectionDataSchema = membershipDataSchema;

export const removeFromCollectionDataSchema = membershipDataSchema;

export const addToCollectionResponseSchema = itemDataSchema(
	addToCollectionDataSchema,
);

export const removeFromCollectionResponseSchema = itemDataSchema(
	removeFromCollectionDataSchema,
);

export type AddToCollectionData = z.infer<typeof addToCollectionDataSchema>;

export type AddToCollectionBody = z.infer<typeof addToCollectionBody>;
export type AddToCollectionResponse = z.infer<
	typeof addToCollectionResponseSchema
>;

export type RemoveFromCollectionBody = z.infer<typeof removeFromCollectionBody>;
export type RemoveFromCollectionData = z.infer<
	typeof removeFromCollectionDataSchema
>;
export type RemoveFromCollectionResponse = z.infer<
	typeof removeFromCollectionResponseSchema
>;

export const collectionResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	...timestampFields,
	entitySchemaId: z.string(),
	image: ImageSchema.nullable(),
	externalId: z.string().nullable(),
	properties: stringUnknownRecordSchema,
	sandboxScriptId: z.string().nullable(),
});

export const createCollectionBody = z.object({
	name: nonEmptyTrimmedStringSchema,
	description: z.string().optional(),
	membershipPropertiesSchema: propertySchemaInputSchema.optional(),
});

export const createCollectionResponseSchema = itemDataSchema(
	collectionResponseSchema,
);

export type CreateCollectionBody = z.infer<typeof createCollectionBody>;
export type CollectionResponse = z.infer<typeof collectionResponseSchema>;
