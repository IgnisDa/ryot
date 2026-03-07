import { z } from "zod";
import { dataSchema, paginatedSchema } from "~/lib/openapi";
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

const scriptPairSchema = z.object({
	searchScriptId: z.string(),
	detailsScriptId: z.string(),
	searchScriptName: z.string(),
	detailsScriptName: z.string(),
});

export type ScriptPair = z.infer<typeof scriptPairSchema>;

const eventSchemaSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
});

export type EventSchema = z.infer<typeof eventSchemaSchema>;

const listedEntitySchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	scriptPairs: z.array(scriptPairSchema),
	eventSchemas: z.array(eventSchemaSchema),
});

export const listEntitySchemasResponseSchema = dataSchema(
	z.array(listedEntitySchema),
);

export const schemaImportResponseSchema = dataSchema(
	z.object({ created: z.boolean(), entityId: z.string() }),
);
