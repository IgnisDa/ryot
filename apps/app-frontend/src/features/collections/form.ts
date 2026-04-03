import type { AppSchema } from "@ryot/ts-utils";
import { z } from "zod";
import {
	buildPropertiesSchema,
	type PropertySchemaRow,
	propertySchemaTypes,
} from "#/features/property-schemas/form";

export const collectionPropertyRowSchema = z.object({
	id: z.string(),
	key: z.string(),
	required: z.boolean(),
	type: z.enum(propertySchemaTypes),
	label: z.string().min(1, "Label is required"),
});

export const createCollectionFormSchema = z.object({
	properties: z.array(collectionPropertyRowSchema),
	name: z.string().trim().min(1, "Name is required"),
});

export type CreateCollectionFormValues = z.infer<
	typeof createCollectionFormSchema
>;

export type CreateCollectionPayload = {
	name: string;
	membershipPropertiesSchema?: AppSchema;
};

export function toCreateCollectionPayload(
	value: CreateCollectionFormValues,
): CreateCollectionPayload {
	const membershipPropertiesSchema =
		value.properties.length > 0
			? buildPropertiesSchema(value.properties as PropertySchemaRow[])
			: undefined;
	return { name: value.name.trim(), membershipPropertiesSchema };
}
