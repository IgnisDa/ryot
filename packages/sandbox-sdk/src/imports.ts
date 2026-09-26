import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { Schema } from "@ryot-app/sandbox-sdk/effect";

import {
	PLUGIN_KIT_SCHEMA_IMPORT,
	SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS,
	SANDBOX_SDK_AUTOMATION_IMPORT,
	SANDBOX_SDK_FILESYSTEM_IMPORT,
	SANDBOX_SDK_IMPORT_WIRE_IMPORT,
	SANDBOX_SDK_PROVIDER_IMPORT,
	SANDBOX_SDK_ROOT_IMPORT,
	SANDBOX_SDK_WORKFLOW_IMPORT,
} from "./runtime-registry";
import { jsonValueSchema, strictStruct } from "./wire";

export { LifecycleCommand };
export * from "./runtime-registry";

export const SANDBOX_SDK_IMPORTS = [
	SANDBOX_SDK_ROOT_IMPORT,
	SANDBOX_SDK_AUTOMATION_IMPORT,
	SANDBOX_SDK_PROVIDER_IMPORT,
	SANDBOX_SDK_WORKFLOW_IMPORT,
	SANDBOX_SDK_FILESYSTEM_IMPORT,
	SANDBOX_SDK_IMPORT_WIRE_IMPORT,
	"@ryot-app/sandbox-sdk/driver",
	"@ryot-app/sandbox-sdk/operation",
	"@ryot-app/sandbox-sdk/wire",
	PLUGIN_KIT_SCHEMA_IMPORT,
	...SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS,
] as const;

const importRecordSchema = Schema.Record(Schema.String, jsonValueSchema);

const hasGenericImportAttribution = (
	command: Schema.Schema.Type<typeof LifecycleCommand>,
	runId: string,
) => {
	const { causation } = command;
	return (
		causation.importRunId === runId &&
		causation.depth === 0 &&
		causation.parentRunId === null &&
		causation.parentTriggerId === null &&
		causation.executionId === causation.rootExecutionId &&
		((causation.source === "import" &&
			causation.integrationId === undefined &&
			causation.initiator.kind === "user") ||
			(causation.source === "integration" &&
				causation.initiator.kind === "integration" &&
				causation.integrationId === causation.initiator.id))
	);
};

export const genericImportFailureSchema = strictStruct({
	message: Schema.String,
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
	entitySchemaSlug: Schema.optional(Schema.String),
	stage: Schema.optional(
		Schema.Literals([
			"input_transformation",
			"provider_resolution",
			"provider_details",
			"event_policy",
			"database_commit",
			"source_fetch",
		]),
	),
});

export const genericImportEntityIntentSchema = strictStruct({
	name: Schema.String,
	alias: Schema.String,
	properties: importRecordSchema,
	entitySchemaSlug: Schema.String,
	entityId: Schema.optional(Schema.String),
	existingOnly: Schema.optional(Schema.Boolean),
	scope: Schema.optional(Schema.Literals(["global", "user"])),
	providerResolution: Schema.optional(
		strictStruct({
			value: Schema.String,
			providerSlug: Schema.String,
			identifierType: Schema.String,
		}),
	),
	match: Schema.optional(
		strictStruct({
			name: Schema.String,
			properties: importRecordSchema,
			nameNormalization: Schema.optional(Schema.Literals(["exact", "slug"])),
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
	propertiesMode: Schema.optional(Schema.Literals(["preserve", "merge"])),
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

const genericImportManifestFields = {
	totalItems: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	failureCount: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	writeItemCount: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
};

export const genericImportAdapterManifestSchema = strictStruct({
	chunkFiles: Schema.Array(Schema.String),
	...genericImportManifestFields,
});

export const genericImportWorkflowManifestSchema = strictStruct({
	chunkHandles: Schema.Array(Schema.String),
	...genericImportManifestFields,
});

export const genericImportWorkflowInputSchema = strictStruct({
	runId: Schema.String,
	source: Schema.String,
	command: LifecycleCommand,
	sourcePayload: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				hasGenericImportAttribution(value.command, value.runId) ||
				"Generic import command attribution does not match the import run",
		),
	),
);

export const genericImportWorkflowResultSchema = strictStruct({
	failedItems: Schema.Number,
	importedItems: Schema.Number,
	processedItems: Schema.Number,
});

export const genericImportKernelInputSchema = strictStruct({
	runId: Schema.String,
	command: LifecycleCommand,
	failRun: Schema.optional(Schema.Boolean),
	chunkHandles: Schema.Array(Schema.String),
	totalItems: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	failureCount: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	writeItemCount: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				hasGenericImportAttribution(value.command, value.runId) ||
				"Generic import command attribution does not match the import run",
		),
	),
);

export type GenericImportChunk = Schema.Schema.Type<typeof genericImportChunkSchema>;
export type GenericImportFailure = Schema.Schema.Type<typeof genericImportFailureSchema>;
export type GenericImportWriteItem = Schema.Schema.Type<typeof genericImportWriteItemSchema>;
export type GenericImportAdapterManifest = Schema.Schema.Type<
	typeof genericImportAdapterManifestSchema
>;
export type GenericImportWorkflowManifest = Schema.Schema.Type<
	typeof genericImportWorkflowManifestSchema
>;
