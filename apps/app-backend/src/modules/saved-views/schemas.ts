import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	applicationIconNameSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";

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
	trackerId: z.string().nullable(),
	icon: applicationIconNameSchema,
	accentColor: nonEmptyTrimmedStringSchema,
	queryDefinition: savedViewQueryDefinitionSchema,
});

export const listSavedViewsResponseSchema = dataSchema(
	z.array(listedSavedViewSchema),
);

export const listSavedViewsQuery = z.object({
	trackerId: nonEmptyTrimmedStringSchema.optional(),
});

export const createSavedViewBody = z.object({
	icon: applicationIconNameSchema,
	name: nonEmptyTrimmedStringSchema,
	accentColor: nonEmptyTrimmedStringSchema,
	trackerId: nonEmptyTrimmedStringSchema.optional(),
	queryDefinition: savedViewQueryDefinitionSchema,
});

export const createSavedViewResponseSchema = dataSchema(listedSavedViewSchema);

export const deleteSavedViewParams = z.object({
	viewId: nonEmptyTrimmedStringSchema,
});

export type ListedSavedView = z.infer<typeof listedSavedViewSchema>;
export type CreateSavedViewBody = z.infer<typeof createSavedViewBody>;
