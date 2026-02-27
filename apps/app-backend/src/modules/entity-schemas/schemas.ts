import { z } from "zod";
import {
	createImportEnvelopeSchema,
	nonEmptyTrimmedStringSchema,
	nullableIntSchema,
	nullableStringSchema,
	positiveIntSchema,
} from "~/lib/zod/base";

export const schemaSearchBody = z.object({
	query: nonEmptyTrimmedStringSchema,
	page: positiveIntSchema.default(1),
	search_script_id: nonEmptyTrimmedStringSchema,
});

export const schemaImportBody = z.object({
	identifier: nonEmptyTrimmedStringSchema,
	details_script_id: nonEmptyTrimmedStringSchema,
});

export const importEnvelope = createImportEnvelopeSchema(z.unknown());

export const schemaSearchItemSchema = z.object({
	title: z.string(),
	identifier: z.string(),
	image: nullableStringSchema.optional(),
	publish_year: nullableIntSchema.optional(),
});

export const schemaSearchResponse = z.object({
	data: z.array(schemaSearchItemSchema),
	meta: z.object({
		hasMore: z.boolean(),
		page: z.number().int().positive(),
		total: z.number().int().nonnegative(),
	}),
});

export type SchemaSearchBody = z.infer<typeof schemaSearchBody>;
export type SchemaImportBody = z.infer<typeof schemaImportBody>;

export type ParsedImportPayload = {
	name: string;
	external_id: string;
	properties: Record<string, unknown>;
};
