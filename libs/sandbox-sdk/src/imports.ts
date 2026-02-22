import { Schema } from "@ryot/sandbox-sdk/effect";

import { jsonValueSchema } from "./wire";

export const SANDBOX_SDK_ROOT_IMPORT = "@ryot/sandbox-sdk/core";
export const SANDBOX_SDK_ACTIVITY_IMPORT = "@ryot/sandbox-sdk/activity";
export const SANDBOX_SDK_AUTOMATION_IMPORT = "@ryot/sandbox-sdk/automation";
export const SANDBOX_SDK_PROVIDER_IMPORT = "@ryot/sandbox-sdk/provider";
export const SANDBOX_SDK_WORKFLOW_IMPORT = "@ryot/sandbox-sdk/workflow";
export const SANDBOX_SDK_FILESYSTEM_IMPORT = "@ryot/sandbox-sdk/filesystem";
export const SANDBOX_SDK_IMPORT_WIRE_IMPORT = "@ryot/sandbox-sdk/imports";

export const SANDBOX_RUNTIME_SDK_IMPORTS = [
	"@ryot/sandbox-sdk/effect",
	"@ryot/sandbox-sdk/cheerio",
	"@ryot/sandbox-sdk/youtubei",
	"@ryot/sandbox-sdk/fflate",
	"@ryot/sandbox-sdk/papaparse",
	"@ryot/sandbox-sdk/fast-xml-parser",
] as const;

export const SANDBOX_SDK_IMPORTS = [
	SANDBOX_SDK_ROOT_IMPORT,
	SANDBOX_SDK_ACTIVITY_IMPORT,
	SANDBOX_SDK_AUTOMATION_IMPORT,
	SANDBOX_SDK_PROVIDER_IMPORT,
	SANDBOX_SDK_WORKFLOW_IMPORT,
	SANDBOX_SDK_FILESYSTEM_IMPORT,
	SANDBOX_SDK_IMPORT_WIRE_IMPORT,
	"@ryot/sandbox-sdk/driver",
	"@ryot/sandbox-sdk/operation",
	"@ryot/sandbox-sdk/wire",
	...SANDBOX_RUNTIME_SDK_IMPORTS,
] as const;

const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });

const importRecordSchema = Schema.Record({ key: Schema.String, value: jsonValueSchema });

export const genericImportFailureSchema = strictStruct({
	message: Schema.String,
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
	entitySchemaSlug: Schema.optional(Schema.String),
	stage: Schema.optional(
		Schema.Literal(
			"input_transformation",
			"provider_resolution",
			"provider_details",
			"event_policy",
			"database_commit",
			"source_fetch",
		),
	),
});

export const genericImportEntityIntentSchema = strictStruct({
	name: Schema.String,
	alias: Schema.String,
	properties: importRecordSchema,
	entitySchemaSlug: Schema.String,
	entityId: Schema.optional(Schema.String),
	existingOnly: Schema.optional(Schema.Boolean),
	scope: Schema.optional(Schema.Literal("global", "user")),
	match: Schema.optional(
		strictStruct({
			name: Schema.String,
			properties: importRecordSchema,
			nameNormalization: Schema.optional(Schema.Literal("exact", "slug")),
		}),
	),
});

export const genericImportEventIntentSchema = strictStruct({
	occurredAt: Schema.String,
	entityAlias: Schema.String,
	properties: importRecordSchema,
	eventSchemaSlug: Schema.String,
	sessionEntityAlias: Schema.optional(Schema.String),
	subjectEntityId: Schema.optional(Schema.NonEmptyString),
});

export const genericImportCollectionMembershipIntentSchema = strictStruct({
	entityAlias: Schema.String,
	collectionName: Schema.String,
});

export const genericImportRelationshipIntentSchema = strictStruct({
	sourceAlias: Schema.String,
	targetAlias: Schema.String,
	properties: importRecordSchema,
	relationshipSchemaSlug: Schema.String,
	propertiesMode: Schema.optional(Schema.Literal("preserve", "merge")),
});

export const genericImportWriteItemSchema = strictStruct({
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
	subjectEntityAlias: Schema.String,
	events: Schema.Array(genericImportEventIntentSchema),
	entities: Schema.Array(genericImportEntityIntentSchema),
	relationships: Schema.Array(genericImportRelationshipIntentSchema),
	collectionMemberships: Schema.optional(
		Schema.Array(genericImportCollectionMembershipIntentSchema),
	),
});

export const genericImportChunkSchema = strictStruct({
	items: Schema.Array(genericImportWriteItemSchema),
	failures: Schema.Array(genericImportFailureSchema),
});

export const genericImportAdapterManifestSchema = strictStruct({
	chunkFiles: Schema.Array(Schema.String),
	totalItems: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	failureCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	writeItemCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export const genericImportWorkflowInputSchema = strictStruct({
	runId: Schema.String,
	source: Schema.String,
	sourcePayload: Schema.optional(Schema.Record({ key: Schema.String, value: jsonValueSchema })),
});

export const genericImportWorkflowResultSchema = strictStruct({
	failedItems: Schema.Number,
	importedItems: Schema.Number,
	processedItems: Schema.Number,
});

export const genericImportKernelInputSchema = strictStruct({
	runId: Schema.String,
	failRun: Schema.optional(Schema.Boolean),
	chunkFiles: Schema.Array(Schema.String),
	integrationId: Schema.optional(Schema.String),
	totalItems: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	failureCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	writeItemCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type GenericImportChunk = Schema.Schema.Type<typeof genericImportChunkSchema>;
export type GenericImportFailure = Schema.Schema.Type<typeof genericImportFailureSchema>;
export type GenericImportWriteItem = Schema.Schema.Type<typeof genericImportWriteItemSchema>;
export type GenericImportAdapterManifest = Schema.Schema.Type<
	typeof genericImportAdapterManifestSchema
>;
