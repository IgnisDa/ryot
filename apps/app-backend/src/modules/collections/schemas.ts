import { z } from "@hono/zod-openapi";
import { ImageSchema } from "~/lib/db/schema";
import { itemDataSchema } from "~/lib/openapi";
import {
	nonEmptyTrimmedStringSchema,
	stringUnknownRecordSchema,
	timestampFields,
} from "~/lib/zod/base";
import { propertySchemaInputSchema } from "../property-schemas/schemas";

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
