import { z } from "@hono/zod-openapi";

export const nullableStringSchema = z.string().nullish();
export const nullableNumberSchema = z.number().nullish();
export const nullableBooleanSchema = z.boolean().nullish();
export const nullableIntSchema = z.number().int().nullish();
export const positiveIntSchema = z.number().int().positive();
export const stringArraySchema = z.array(z.string());
export const sortOrderSchema = z.number().int().nonnegative();
export const nonEmptyStringSchema = z.string().min(1);
export const nonEmptyTrimmedStringSchema = z.string().trim().min(1);
export const stringUnknownRecordSchema = z.record(z.string(), z.unknown());
export const applicationIconNameSchema = nonEmptyTrimmedStringSchema.describe(
	"A Lucide icon name (e.g., 'book', 'dumbbell', 'gamepad-2'). See https://lucide.dev/icons/",
);

export const timestampFields = {
	createdAt: z.date(),
	updatedAt: z.date(),
} satisfies z.ZodRawShape;

export const iconAndAccentColorFields = {
	icon: applicationIconNameSchema,
	accentColor: nonEmptyTrimmedStringSchema,
} satisfies z.ZodRawShape;

export const optionalIconAndAccentColorFields = {
	icon: applicationIconNameSchema.optional(),
	accentColor: nonEmptyTrimmedStringSchema.optional(),
} satisfies z.ZodRawShape;

export const createIdParamsSchema = <TParamName extends string>(
	paramName: TParamName,
) =>
	z.object({
		[paramName]: nonEmptyTrimmedStringSchema,
	} as Record<TParamName, typeof nonEmptyTrimmedStringSchema>);

export const createNonEmptyStringArraySchema = (message: string) =>
	z.array(z.string()).min(1, message);

export const createUniqueNonEmptyTrimmedStringArraySchema = (input: {
	minMessage?: string;
	duplicateMessage: string;
}) =>
	z
		.array(nonEmptyTrimmedStringSchema)
		.min(1, input.minMessage)
		.superRefine((value, ctx) => {
			if (new Set(value).size === value.length) {
				return;
			}

			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: input.duplicateMessage,
			});
		});

export const createNameWithOptionalSlugSchema = <TShape extends z.ZodRawShape>(
	shape: TShape,
) =>
	z.object({
		name: nonEmptyTrimmedStringSchema,
		slug: nonEmptyTrimmedStringSchema.optional(),
		...shape,
	});

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
