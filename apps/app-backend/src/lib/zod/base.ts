import { toJSONSchema, z } from "zod";

export const nonEmptyStringSchema = z.string().min(1);
export const nullableIntSchema = z.number().int().nullable();
export const stringArraySchema = z.array(z.string());
export const nullableStringSchema = z.string().nullable();
export const nullableNumberSchema = z.number().nullable();
export const nullableBooleanSchema = z.boolean().nullable();
export const positiveIntSchema = z.number().int().positive();
export const stringUnknownRecordSchema = z.record(z.string(), z.unknown());

export const nonEmptyTrimmedStringSchema = z.string().trim().min(1);

export const createImportEnvelopeSchema = <TProperties extends z.ZodType>(
	propertiesSchema: TProperties,
) =>
	z
		.object({
			name: z.string(),
			properties: propertiesSchema,
			external_id: nonEmptyTrimmedStringSchema,
		})
		.strict();

export const remoteImagesAssetsSchema = z
	.object({ remote_images: stringArraySchema })
	.strict();

export const toStableJsonSchema = <TSchema extends z.ZodType>(
	schema: TSchema,
) => JSON.parse(JSON.stringify(toJSONSchema(schema)));
