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
	searchScriptId: nonEmptyTrimmedStringSchema,
});

export const schemaImportBody = z.object({
	identifier: nonEmptyTrimmedStringSchema,
	detailsScriptId: nonEmptyTrimmedStringSchema,
});

export const importEnvelope = createImportEnvelopeSchema(z.unknown());

export const schemaSearchItemSchema = z.object({
	title: z.string(),
	identifier: z.string(),
	image: nullableStringSchema,
	publishYear: nullableIntSchema,
});

export const schemaSearchResponse = paginatedSchema(schemaSearchItemSchema);

export type SchemaSearchBody = z.infer<typeof schemaSearchBody>;
export type SchemaImportBody = z.infer<typeof schemaImportBody>;

export type ParsedImportPayload = {
	name: string;
	externalId: string;
	properties: Record<string, unknown>;
};
