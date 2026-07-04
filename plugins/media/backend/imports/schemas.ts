import { genericImportFailureSchema } from "@ryot-app/sandbox-sdk/imports";
import { jsonValueSchema, strictStruct } from "@ryot-app/sandbox-sdk/wire";
import { Schema } from "@ryot-app/sandbox-sdk/workflow";

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

export const UnresolvedEpisodeRef = Schema.Union([
	Schema.Struct({ seasonNumber: Schema.Int, type: Schema.Literal("show-season") }),
	Schema.Struct({
		seasonNumber: Schema.Int,
		episodeNumber: Schema.Int,
		type: Schema.Literal("show"),
	}),
	Schema.Struct({ episodeNumber: Schema.Int, type: Schema.Literal("podcast") }),
]);

export type UnresolvedEpisodeRef = typeof UnresolvedEpisodeRef.Type;

const mediaEventFields = {
	occurredAt: Schema.String,
	eventSchemaSlug: Schema.String,
	properties: Schema.Record(Schema.String, jsonValueSchema),
};

const ImportMediaEvent = Schema.Struct({
	...mediaEventFields,
	unresolvedEpisode: Schema.optional(UnresolvedEpisodeRef),
});

export type ImportMediaEvent = typeof ImportMediaEvent.Type;

const mediaEntityGroupFields = {
	itemIndex: Schema.Number,
	entityRef: ImportEntityRef,
	ownershipProvider: Schema.optional(Schema.String),
	collectionMemberships: Schema.Array(Schema.Struct({ collectionName: Schema.String })),
};

export const ImportMediaEntityGroup = Schema.Struct({
	...mediaEntityGroupFields,
	events: Schema.Array(ImportMediaEvent),
});

export type ImportMediaEntityGroup = typeof ImportMediaEntityGroup.Type;

export const MediaImportAdapterFailure = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Number,
	sourceLabel: Schema.optional(Schema.String),
	stage: genericImportFailureSchema.fields.stage,
	sourceIdentifier: Schema.optional(Schema.String),
	entitySchemaSlug: genericImportFailureSchema.fields.entitySchemaSlug,
	context: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
});

export type MediaImportAdapterFailure = typeof MediaImportAdapterFailure.Type;

export const MediaIntegrationAdapterResult = Schema.Struct({
	failures: Schema.Array(MediaImportAdapterFailure),
	entityGroups: Schema.Array(ImportMediaEntityGroup),
});

export type MediaIntegrationAdapterResult = typeof MediaIntegrationAdapterResult.Type;

export const MediaImportAdapterBatch = Schema.Struct({
	...MediaIntegrationAdapterResult.fields,
	totalItems: Schema.Number,
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

export const MediaImportParserInput = Schema.Struct({ start: Schema.Number, limit: Schema.Number });

export const MediaImportDispatchParserInput = Schema.Struct({
	...MediaImportParserInput.fields,
	url: Schema.optional(TraktImportUrl),
	apiKey: Schema.optional(Schema.String),
	apiUrl: Schema.optional(Schema.String),
	password: Schema.optional(Schema.String),
	username: Schema.optional(Schema.String),
	collection: Schema.optional(Schema.String),
	profileName: Schema.optional(Schema.String),
	hasAnimeFile: Schema.optional(Schema.Boolean),
	hasMangaFile: Schema.optional(Schema.Boolean),
	hasExportFile: Schema.optional(Schema.Boolean),
	allowInsecureConnections: Schema.optional(Schema.Boolean),
	mode: Schema.optional(
		Schema.Union([Schema.Literal("user"), Schema.Literal("list"), Schema.Literal("export")]),
	),
});

export const TraktImportParserInput = Schema.Union([
	strictStruct({ ...MediaImportParserInput.fields, ...traktUserTarget.fields }),
	strictStruct({ ...MediaImportParserInput.fields, ...traktListTarget.fields }),
	strictStruct({
		...MediaImportParserInput.fields,
		mode: Schema.Literal("export"),
		hasExportFile: Schema.Literal(true),
	}),
]);

export const UrlAndKeyImportParserInput = Schema.Struct({
	...MediaImportParserInput.fields,
	apiKey: Schema.String,
	apiUrl: Schema.String,
	allowInsecureConnections: Schema.optional(Schema.Boolean),
});

export const JellyfinImportParserInput = Schema.Struct({
	...MediaImportParserInput.fields,
	apiUrl: Schema.String,
	username: Schema.String,
	password: Schema.optional(Schema.String),
	allowInsecureConnections: Schema.optional(Schema.Boolean),
});

export const NetflixImportParserInput = Schema.Struct({
	...MediaImportParserInput.fields,
	profileName: Schema.optional(Schema.String),
});

export const MyanimelistImportParserInput = Schema.Struct({
	...MediaImportParserInput.fields,
	hasAnimeFile: Schema.Boolean,
	hasMangaFile: Schema.Boolean,
});

export const IgdbImportParserInput = Schema.Struct({
	...MediaImportParserInput.fields,
	collection: Schema.String,
});

const MediaImportFinalizedEvent = Schema.Struct({
	...mediaEventFields,
	subjectEntityId: Schema.optional(Schema.NonEmptyString),
});

const MediaImportFinalizedEntityGroup = Schema.Struct({
	...mediaEntityGroupFields,
	events: Schema.Array(MediaImportFinalizedEvent),
});

export const MediaImportWriteChunkInput = Schema.Struct({
	failures: Schema.Array(MediaImportAdapterFailure),
	entityGroups: Schema.Array(MediaImportFinalizedEntityGroup),
	populationResults: MediaImportPopulationWorkflowOutput.fields.results,
});

export type MediaImportWriteChunkInput = typeof MediaImportWriteChunkInput.Type;
