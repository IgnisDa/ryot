import { toJSONSchema, z } from "zod";

export const nullableStringSchema = z.string().nullish();
export const nullableNumberSchema = z.number().nullish();
export const nullableBooleanSchema = z.boolean().nullish();
export const nullableIntSchema = z.number().int().nullish();
export const positiveIntSchema = z.number().int().positive();
export const stringArraySchema = z.array(z.string());
export const nonEmptyStringSchema = z.string().min(1);
export const nonEmptyTrimmedStringSchema = z.string().trim().min(1);
export const stringUnknownRecordSchema = z.record(z.string(), z.unknown());

export const createImportEnvelopeSchema = <TProperties extends z.ZodType>(
	propertiesSchema: TProperties,
) =>
	z
		.object({
			name: z.string(),
			properties: propertiesSchema,
			externalId: nonEmptyTrimmedStringSchema,
		})
		.strict();

export const remoteImagesAssetsSchema = z
	.object({ remoteImages: stringArraySchema })
	.strict();

export const toStableJsonSchema = <TSchema extends z.ZodType>(
	schema: TSchema,
) => JSON.parse(JSON.stringify(toJSONSchema(schema)));
