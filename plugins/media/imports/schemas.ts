import { genericImportFailureSchema } from "@ryot/sandbox-sdk/imports";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Schema } from "@ryot/sandbox-sdk/workflow";

import { MediaImportPopulationWorkflowOutput } from "../workflows/schemas";

const ResolvedEntityRef = Schema.Struct({
	externalId: Schema.String,
	sourceLabel: Schema.String,
	providerSlug: Schema.String,
	kind: Schema.Literal("resolved"),
	entitySchemaSlug: Schema.String,
});

const UnresolvedEntityRef = Schema.Struct({
	sourceLabel: Schema.String,
	identifierType: Schema.String,
	identifierValue: Schema.String,
	kind: Schema.Literal("unresolved"),
	entitySchemaSlug: Schema.String,
});

export const ImportEntityRef = Schema.Union(ResolvedEntityRef, UnresolvedEntityRef);

export type ImportEntityRef = typeof ImportEntityRef.Type;

export const UnresolvedEpisodeRef = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("show"),
		seasonNumber: Schema.Int,
		episodeNumber: Schema.Int,
	}),
	Schema.Struct({
		type: Schema.Literal("podcast"),
		episodeNumber: Schema.Int,
	}),
);

export type UnresolvedEpisodeRef = typeof UnresolvedEpisodeRef.Type;

const mediaEventFields = {
	occurredAt: Schema.String,
	eventSchemaSlug: Schema.String,
	properties: Schema.Record({ key: Schema.String, value: jsonValueSchema }),
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
	stage: genericImportFailureSchema.fields.stage,
	sourceLabel: Schema.optional(Schema.String),
	sourceIdentifier: Schema.optional(Schema.String),
	entitySchemaSlug: genericImportFailureSchema.fields.entitySchemaSlug,
	context: Schema.optional(Schema.Record({ key: Schema.String, value: jsonValueSchema })),
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

export const MediaImportParserInput = Schema.Struct({
	start: Schema.Number,
	limit: Schema.Number,
});

export const MediaImportDispatchParserInput = Schema.Struct({
	...MediaImportParserInput.fields,
	apiKey: Schema.optional(Schema.String),
	apiUrl: Schema.optional(Schema.String),
	collection: Schema.optional(Schema.String),
	password: Schema.optional(Schema.String),
	profileName: Schema.optional(Schema.String),
	username: Schema.optional(Schema.String),
	hasAnimeFile: Schema.optional(Schema.Boolean),
	hasMangaFile: Schema.optional(Schema.Boolean),
	allowInsecureConnections: Schema.optional(Schema.Boolean),
});

export const TraktImportParserInput = Schema.Struct({
	...MediaImportParserInput.fields,
	username: Schema.String,
});

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
