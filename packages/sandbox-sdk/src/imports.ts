import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	IngestionActivity,
	IngestionSummary,
	IngestionIssue,
	IngestionPlan,
	IngestionAttribution,
	IngestionOutcome,
	IngestionReason,
} from "@ryot-app/contract/modules/imports/ingestion";
import { KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW } from "@ryot-app/contract/modules/plugins/execution";
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
import { defineWorkflowReference } from "./workflow";

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

export const ingestionArtifactsSchema = strictStruct({
	runId: Schema.NonEmptyString,
	captures: Schema.Record(
		Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,100}$/)),
		Schema.NonEmptyString,
	).check(
		Schema.makeFilter(
			(captures) =>
				(Object.keys(captures).length >= 1 && Object.keys(captures).length <= 100) ||
				"Capture grants require 1..100 names",
		),
	),
});

const ingestionIntentFields = {
	operationId: Schema.NonEmptyString,
	attribution: Schema.optional(IngestionAttribution),
	outcome: Schema.optional(
		strictStruct({
			unit: IngestionOutcome.fields.unit,
			recordKind: IngestionOutcome.fields.recordKind,
		}),
	),
};

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
	itemIndex: Schema.Finite,
	sourceLabel: Schema.String,
	unit: Schema.NonEmptyString,
	sourceIdentifier: Schema.String,
	recordKind: Schema.NonEmptyString,
	operationId: Schema.NonEmptyString,
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
	...ingestionIntentFields,
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
	...ingestionIntentFields,
	occurredAt: Schema.String,
	entityAlias: Schema.String,
	properties: importRecordSchema,
	eventSchemaSlug: Schema.String,
	sessionEntityAlias: Schema.optional(Schema.String),
	subjectEntityId: Schema.optional(Schema.NonEmptyString),
});

export const genericImportCollectionMembershipIntentSchema = strictStruct({
	...ingestionIntentFields,
	entityAlias: Schema.String,
	collectionName: Schema.String,
});

export const genericImportRelationshipIntentSchema = strictStruct({
	...ingestionIntentFields,
	sourceAlias: Schema.String,
	targetAlias: Schema.String,
	properties: importRecordSchema,
	relationshipSchemaSlug: Schema.String,
	propertiesMode: Schema.optional(Schema.Literals(["preserve", "merge"])),
});

export const genericImportWriteItemSchema = strictStruct({
	itemIndex: Schema.Finite,
	sourceLabel: Schema.String,
	recordId: Schema.NonEmptyString,
	sourceIdentifier: Schema.String,
	subjectEntityAlias: Schema.String,
	events: Schema.Array(genericImportEventIntentSchema),
	entities: Schema.Array(genericImportEntityIntentSchema),
	relationships: Schema.Array(genericImportRelationshipIntentSchema),
	collectionMemberships: Schema.optional(
		Schema.Array(genericImportCollectionMembershipIntentSchema),
	),
});

const genericImportChunkShape = strictStruct({
	items: Schema.Array(genericImportWriteItemSchema).pipe(Schema.check(Schema.isMaxLength(100))),
	failures: Schema.Array(genericImportFailureSchema).pipe(Schema.check(Schema.isMaxLength(100))),
});

export const genericImportItemIntents = (item: GenericImportWriteItem) => [
	...item.entities,
	...item.relationships,
	...item.events,
	...(item.collectionMemberships ?? []),
];

export const genericImportChunkOperationIds = (
	chunk: Schema.Schema.Type<typeof genericImportChunkShape>,
) => [
	...chunk.items.flatMap((item) =>
		genericImportItemIntents(item).map(({ operationId }) => operationId),
	),
	...chunk.failures.map((failure) => failure.operationId),
];

export const genericImportChunkSchema = genericImportChunkShape.pipe(
	Schema.check(
		Schema.makeFilter((chunk) => {
			const ids = genericImportChunkOperationIds(chunk);
			return (
				(ids.length <= 1000 &&
					new Set(ids).size === ids.length &&
					new Set(chunk.items.map((item) => item.recordId)).size === chunk.items.length) ||
				"Ingestion chunk identities must be unique and bounded"
			);
		}),
	),
);

export const genericImportWorkflowInputSchema = strictStruct({
	plan: IngestionPlan,
	runId: Schema.String,
	source: Schema.String,
	command: LifecycleCommand,
	sourcePayloadHandle: Schema.NonEmptyString,
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
	summary: IngestionSummary,
	issues: Schema.Array(IngestionIssue).pipe(Schema.check(Schema.isMaxLength(1000))),
});

export const genericImportCaptureResultSchema = strictStruct({
	handle: Schema.NonEmptyString,
	captureId: Schema.NonEmptyString,
	inputFingerprint: Schema.NonEmptyString,
});
export const genericImportMaterializeResultSchema = strictStruct({ handle: Schema.NonEmptyString });
export const genericImportArtifactSchema = strictStruct({
	runId: Schema.NonEmptyString,
	captureId: Schema.NonEmptyString,
});
export const genericImportActivityResultSchema = strictStruct({ recorded: Schema.Literal(true) });
export const genericImportSealResultSchema = strictStruct({
	summary: IngestionSummary,
	sealed: Schema.Literal(true),
});
export const genericImportCapturesResultSchema = strictStruct({
	next: Schema.NullOr(Schema.Int),
	captures: Schema.Array(
		strictStruct({
			ordinal: Schema.Int,
			checkpoint: jsonValueSchema,
			captureId: Schema.NonEmptyString,
			inputFingerprint: Schema.NonEmptyString,
		}),
	).pipe(Schema.check(Schema.isMaxLength(100))),
});
export const genericImportApplyResultSchema = strictStruct({
	summary: IngestionSummary,
	issues: Schema.Array(IngestionIssue).pipe(Schema.check(Schema.isMaxLength(1000))),
	confirmed: Schema.Array(
		strictStruct({
			attribution: IngestionAttribution,
			operationId: Schema.NonEmptyString,
			reason: Schema.NullOr(IngestionReason),
			result: Schema.Literals(["created", "updated", "unchanged", "skipped"]),
		}),
	).pipe(Schema.check(Schema.isMaxLength(1000))),
});
export const integrationConfirmationSchema = strictStruct({
	runId: Schema.String,
	final: Schema.Boolean,
	batchId: Schema.String,
	inputFingerprint: Schema.String,
	confirmed: genericImportApplyResultSchema.fields.confirmed,
	part: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export const integrationConfirmationWorkflowInputSchema = strictStruct({
	plan: IngestionPlan,
	integrationContext: jsonValueSchema,
	ingestionConfirmation: integrationConfirmationSchema,
});
export const integrationConfirmationWorkflowResultSchema = strictStruct({
	confirmed: Schema.Literal(true),
});

const ordinalSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const encodeCheckpoint = Schema.encodeSync(Schema.fromJsonString(jsonValueSchema));
const captureOperation = strictStruct({
	ordinal: ordinalSchema,
	handle: Schema.NonEmptyString,
	captureId: Schema.NonEmptyString,
	action: Schema.Literal("capture"),
	phase: Schema.Literals(["collection", "application"]),
	checkpoint: jsonValueSchema.pipe(
		Schema.check(
			Schema.makeFilter(
				(value) =>
					new TextEncoder().encode(encodeCheckpoint(value)).byteLength <= 16 * 1024 ||
					"Ingestion checkpoint exceeds its byte limit",
			),
		),
	),
});
const applyOperation = strictStruct({
	ordinal: ordinalSchema,
	batchId: Schema.NonEmptyString,
	action: Schema.Literal("apply"),
	captureId: Schema.NonEmptyString,
	inputFingerprint: Schema.NonEmptyString,
});
const sealOperation = strictStruct({ action: Schema.Literal("seal") });
const activityOperation = strictStruct({
	activity: IngestionActivity,
	action: Schema.Literal("activity"),
});
const materializeOperation = strictStruct({
	captureId: Schema.NonEmptyString,
	action: Schema.Literal("materialize"),
});
const capturesOperation = strictStruct({
	action: Schema.Literal("captures"),
	after: Schema.NullOr(ordinalSchema),
	limit: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
const kernelAttributionSchema = Schema.Struct({ runId: Schema.String, command: LifecycleCommand });
const kernelAttributionFilter = Schema.makeFilter(
	(value: typeof kernelAttributionSchema.Type) =>
		hasGenericImportAttribution(value.command, value.runId) ||
		"Generic import command attribution does not match the import run",
);

export const genericImportCaptureInputSchema = strictStruct({
	...kernelAttributionSchema.fields,
	operation: captureOperation,
}).pipe(Schema.check(kernelAttributionFilter));
export const genericImportApplyInputSchema = strictStruct({
	...kernelAttributionSchema.fields,
	operation: applyOperation,
}).pipe(Schema.check(kernelAttributionFilter));
export const genericImportSealInputSchema = strictStruct({
	...kernelAttributionSchema.fields,
	operation: sealOperation,
}).pipe(Schema.check(kernelAttributionFilter));
export const genericImportActivityInputSchema = strictStruct({
	...kernelAttributionSchema.fields,
	operation: activityOperation,
}).pipe(Schema.check(kernelAttributionFilter));
export const genericImportMaterializeInputSchema = strictStruct({
	...kernelAttributionSchema.fields,
	operation: materializeOperation,
}).pipe(Schema.check(kernelAttributionFilter));
export const genericImportCapturesInputSchema = strictStruct({
	...kernelAttributionSchema.fields,
	operation: capturesOperation,
}).pipe(Schema.check(kernelAttributionFilter));
export const genericImportKernelInputSchema = strictStruct({
	...kernelAttributionSchema.fields,
	operation: Schema.Union([
		captureOperation,
		applyOperation,
		sealOperation,
		activityOperation,
		materializeOperation,
		capturesOperation,
	]),
}).pipe(Schema.check(kernelAttributionFilter));

export type GenericImportChunk = Schema.Schema.Type<typeof genericImportChunkSchema>;

export const genericImportCaptureReference = defineWorkflowReference({
	input: genericImportCaptureInputSchema,
	output: genericImportCaptureResultSchema,
	workflowSlug: KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
});
export const genericImportMaterializeReference = defineWorkflowReference({
	input: genericImportMaterializeInputSchema,
	output: genericImportMaterializeResultSchema,
	workflowSlug: KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
});
export const genericImportCapturesReference = defineWorkflowReference({
	input: genericImportCapturesInputSchema,
	output: genericImportCapturesResultSchema,
	workflowSlug: KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
});
export const genericImportApplyReference = defineWorkflowReference({
	input: genericImportApplyInputSchema,
	output: genericImportApplyResultSchema,
	workflowSlug: KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
});
export const genericImportActivityReference = defineWorkflowReference({
	input: genericImportActivityInputSchema,
	output: genericImportActivityResultSchema,
	workflowSlug: KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
});
export const genericImportSealReference = defineWorkflowReference({
	input: genericImportSealInputSchema,
	output: genericImportSealResultSchema,
	workflowSlug: KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
});
export type GenericImportFailure = Schema.Schema.Type<typeof genericImportFailureSchema>;
export type GenericImportWriteItem = Schema.Schema.Type<typeof genericImportWriteItemSchema>;
