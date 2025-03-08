import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";

export const savedViewQueryDefinitionSchema = z.object({
	entitySchemaIds: z.array(z.string()),
});

export type SavedViewQueryDefinition = z.infer<
	typeof savedViewQueryDefinitionSchema
>;

export const listedSavedViewSchema = z.object({
	id: z.string(),
	name: z.string(),
	isBuiltin: z.boolean(),
	queryDefinition: savedViewQueryDefinitionSchema,
});

export const listSavedViewsResponseSchema = dataSchema(
	z.array(listedSavedViewSchema),
);

export const listSavedViewsQuery = z.object({
	facetId: nonEmptyTrimmedStringSchema.optional(),
});

export const createSavedViewBody = z.object({
	name: nonEmptyTrimmedStringSchema,
	queryDefinition: savedViewQueryDefinitionSchema,
});

export const createSavedViewResponseSchema = dataSchema(listedSavedViewSchema);

export const deleteSavedViewParams = z.object({
	viewId: nonEmptyTrimmedStringSchema,
});
