import { z } from "@hono/zod-openapi";
import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { appPropertyPrimitiveTypes } from "@ryot/ts-utils";

const propertyDefinitionFlags = {
	nullable: z.literal(true).optional(),
	required: z.literal(true).optional(),
};

const primitivePropertySchema = z
	.object({
		...propertyDefinitionFlags,
		type: z.enum(appPropertyPrimitiveTypes),
	})
	.openapi("AppPrimitiveProperty");

let propertyDefinitionSchema: z.ZodType<AppPropertyDefinition>;

const arrayPropertySchema = z
	.object({
		...propertyDefinitionFlags,
		type: z.literal("array"),
		items: z.lazy(() => propertyDefinitionSchema),
	})
	.openapi("AppArrayProperty");

const objectPropertySchema = z
	.object({
		...propertyDefinitionFlags,
		type: z.literal("object"),
		properties: z.record(
			z.string(),
			z.lazy(() => propertyDefinitionSchema),
		),
	})
	.openapi("AppObjectProperty");

propertyDefinitionSchema = z
	.lazy(() =>
		z.union([
			primitivePropertySchema,
			arrayPropertySchema,
			objectPropertySchema,
		]),
	)
	.openapi(
		"AppPropertyDefinition",
	) as unknown as z.ZodType<AppPropertyDefinition>;

export { propertyDefinitionSchema };

export const createPropertySchemaObjectSchema = (message: string) =>
	z
		.record(z.string(), propertyDefinitionSchema)
		.refine((value) => Object.keys(value).length > 0, { message });

export const propertySchemaObjectSchema: z.ZodType<AppSchema> =
	createPropertySchemaObjectSchema(
		"Properties must contain at least one property",
	).openapi("AppSchema");

export const propertySchemaInputSchema = propertySchemaObjectSchema;

export const createPropertySchemaInputSchema = (message: string) =>
	createPropertySchemaObjectSchema(message);
