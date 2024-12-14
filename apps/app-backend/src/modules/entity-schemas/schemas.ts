import { z } from "zod";
import { paginatedSchema } from "~/lib/openapi";
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

export const schemaSearchResponse = paginatedSchema(schemaSearchItemSchema);

export type SchemaSearchBody = z.infer<typeof schemaSearchBody>;
export type SchemaImportBody = z.infer<typeof schemaImportBody>;

export type ParsedImportPayload = {
	name: string;
	external_id: string;
	properties: Record<string, unknown>;
};
