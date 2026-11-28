import {
	genericImportEventIntentSchema,
	genericImportFailureSchema,
	ingestionArtifactsSchema,
} from "@ryot-app/plugin-backend-sdk/imports";
import { jsonValueSchema, strictStruct } from "@ryot-app/plugin-backend-sdk/wire";
import { Schema } from "@ryot-app/plugin-backend-sdk/workflow";

import { MediaCopyDetails } from "../../shared/media-copy";
import { UnresolvedEpisodeRef } from "../../shared/media-history";
import { MediaImportPopulationWorkflowOutput } from "../contracts/workflows";

const isHttpUrl = (value: string): true | string => {
	try {
		const url = new URL(value.trim());
		return ["http:", "https:"].includes(url.protocol) ? true : "must be a valid http or https URL";
	} catch {
		return "must be a valid http or https URL";
	}
};

export const TraktImportUrl = Schema.String.pipe(Schema.check(Schema.makeFilter(isHttpUrl)));

const ResolvedEntityRef = Schema.Struct({
	externalId: Schema.String,
	sourceLabel: Schema.String,
	providerSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	kind: Schema.Literal("resolved"),
});

const UnresolvedEntityRef = Schema.Struct({
	sourceLabel: Schema.String,
	identifierType: Schema.String,
	identifierValue: Schema.String,
	entitySchemaSlug: Schema.String,
	kind: Schema.Literal("unresolved"),
});

export const ImportEntityRef = Schema.Union([ResolvedEntityRef, UnresolvedEntityRef]);

export type ImportEntityRef = typeof ImportEntityRef.Type;

export const NetflixResolutionInput = Schema.Struct({
	items: Schema.Array(
		Schema.Struct({ index: Schema.Int, title: Schema.String, entitySchemaSlug: Schema.String }),
	),
});
export const NetflixResolutionOutput = Schema.Struct({
	results: Schema.Array(
		Schema.Struct({ index: Schema.Int, entityRef: Schema.NullOr(ResolvedEntityRef) }),
	),
});

const mediaEventFields = {
	occurredAt: Schema.String,
	eventSchemaSlug: Schema.String,
	sourceItemIndex: Schema.optional(Schema.Finite),
	operationId: Schema.optional(Schema.NonEmptyString),
	continuousProgress: Schema.optional(Schema.Literal(true)),
	properties: Schema.Record(Schema.String, jsonValueSchema),
	attribution: genericImportEventIntentSchema.fields.attribution,
};

const ImportMediaEvent = Schema.Struct({
	...mediaEventFields,
	unresolvedEpisode: Schema.optional(UnresolvedEpisodeRef),
});

export type ImportMediaEvent = typeof ImportMediaEvent.Type;

export const ImportedMediaCopy = Schema.Struct({
	details: MediaCopyDetails,
	source: Schema.NonEmptyString,
	subjectEntityId: Schema.optional(Schema.NonEmptyString),
	unresolvedEpisode: Schema.optional(UnresolvedEpisodeRef),
	sourceId: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
	subjectEntitySchemaSlug: Schema.optional(Schema.NonEmptyString),
});

const mediaEntityGroupFields = {
	itemIndex: Schema.Finite,
	entityRef: ImportEntityRef,
	copies: Schema.optional(Schema.Array(ImportedMediaCopy)),
	collectionMemberships: Schema.Array(Schema.Struct({ collectionName: Schema.String })),
};

export const ImportMediaEntityGroup = Schema.Struct({
	...mediaEntityGroupFields,
	events: Schema.Array(ImportMediaEvent),
});

export type ImportMediaEntityGroup = typeof ImportMediaEntityGroup.Type;

export const MediaImportBatchEntityGroup = Schema.Struct({
	...mediaEntityGroupFields,
	events: Schema.Array(
		Schema.Struct({ ...ImportMediaEvent.fields, operationId: Schema.NonEmptyString }),
	),
});

export type MediaImportBatchEntityGroup = typeof MediaImportBatchEntityGroup.Type;

export const MediaImportAdapterFailure = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Finite,
	sourceLabel: Schema.optional(Schema.String),
	unit: Schema.optional(Schema.NonEmptyString),
	stage: genericImportFailureSchema.fields.stage,
	detail: genericImportFailureSchema.fields.detail,
	sourceIdentifier: Schema.optional(Schema.String),
	recordKind: Schema.optional(Schema.NonEmptyString),
	entitySchemaSlug: genericImportFailureSchema.fields.entitySchemaSlug,
	context: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
});

export type MediaImportAdapterFailure = typeof MediaImportAdapterFailure.Type;

export const MediaImportFailure = Schema.Struct({
	...MediaImportAdapterFailure.fields,
	operationId: genericImportFailureSchema.fields.operationId,
});

export type MediaImportFailure = typeof MediaImportFailure.Type;

export const MediaIntegrationAdapterResult = Schema.Struct({
	failures: Schema.Array(MediaImportAdapterFailure),
	entityGroups: Schema.Array(ImportMediaEntityGroup),
	sourceFailure: Schema.optional(
		Schema.Literals(["input-transformation-failed", "source-fetch-failed"]),
	),
});

export type MediaIntegrationAdapterResult = typeof MediaIntegrationAdapterResult.Type;

export const MediaImportAdapterBatch = Schema.Struct({
	...MediaIntegrationAdapterResult.fields,
	totalItems: Schema.Finite,
	failures: Schema.Array(MediaImportFailure),
	entityGroups: Schema.Array(MediaImportBatchEntityGroup),
});

const traktUserTarget = strictStruct({
	mode: Schema.Literal("user"),
	username: Schema.NonEmptyString,
});

const traktListTarget = strictStruct({
	url: TraktImportUrl,
	mode: Schema.Literal("list"),
	collection: Schema.NonEmptyString,
});

const traktExportTarget = strictStruct({
	mode: Schema.Literal("export"),
	exportUploadToken: Schema.Literal("exportUploadToken"),
});

export const TraktImportTarget = Schema.Union([
	traktUserTarget,
	traktListTarget,
	traktExportTarget,
]);

export type TraktImportTarget = typeof TraktImportTarget.Type;

const MediaImportFinalizedEvent = Schema.Struct({
	...mediaEventFields,
	operationId: Schema.NonEmptyString,
	subjectEntityId: Schema.optional(Schema.NonEmptyString),
	coalescing: genericImportEventIntentSchema.fields.coalescing,
	subjectEntitySchemaSlug: Schema.optional(Schema.NonEmptyString),
});

const MediaImportFinalizedEntityGroup = Schema.Struct({
	...mediaEntityGroupFields,
	events: Schema.Array(MediaImportFinalizedEvent),
});

export const MediaImportWriteChunkInput = Schema.Struct({
	failures: Schema.Array(MediaImportFailure),
	entityGroups: Schema.Array(MediaImportFinalizedEntityGroup),
	ingestionArtifacts: Schema.optional(ingestionArtifactsSchema),
	populationResults: MediaImportPopulationWorkflowOutput.fields.results,
	integration: Schema.optional(
		Schema.Struct({ importRunId: Schema.String, integrationId: Schema.String }),
	),
});

export type MediaImportWriteChunkInput = typeof MediaImportWriteChunkInput.Type;

export const MediaImportWriteChunkActivityInput = Schema.Struct({
	...MediaImportWriteChunkInput.fields,
});
