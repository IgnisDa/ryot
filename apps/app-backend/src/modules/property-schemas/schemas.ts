import { z } from "@hono/zod-openapi";
import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { appPropertyPrimitiveTypes } from "@ryot/ts-utils";

const propertySchemaMessage = "Properties must contain at least one property";

const createPropertySchemaMessage = (label: string) =>
	`${label} must contain at least one property`;

const propertyDefinitionFlags = {
	required: z.literal(true).optional(),
};

const primitivePropertySchema = z
	.strictObject({
		...propertyDefinitionFlags,
		type: z.enum(appPropertyPrimitiveTypes),
	})
	.openapi("AppPrimitiveProperty");

let propertyDefinitionSchema: z.ZodType<AppPropertyDefinition>;

const arrayPropertySchema = z
	.strictObject({
		...propertyDefinitionFlags,
		type: z.literal("array"),
		items: z.lazy(() => propertyDefinitionSchema),
	})
	.openapi("AppArrayProperty");

const objectPropertySchema = z
	.strictObject({
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
		z.discriminatedUnion("type", [
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

export const createPropertySchemaInputSchema = createPropertySchemaObjectSchema;

export const createLabeledPropertySchemas = (label: string) => {
	const message = createPropertySchemaMessage(label);
	const schema = createPropertySchemaObjectSchema(message);

	return { schema };
};

export const propertySchemaObjectSchema: z.ZodType<AppSchema> =
	createPropertySchemaObjectSchema(propertySchemaMessage).openapi("AppSchema");

export const propertySchemaInputSchema = propertySchemaObjectSchema;
