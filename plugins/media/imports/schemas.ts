import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Schema } from "@ryot/sandbox-sdk/workflow";

import { MediaImportPopulationWorkflowOutput } from "../workflows/schemas";

const ImportEntityRef = Schema.Union(
	Schema.Struct({
		sourceLabel: Schema.String,
		kind: Schema.Literal("resolved"),
		providerSlug: Schema.String,
		externalId: Schema.String,
		entitySchemaSlug: Schema.String,
	}),
	Schema.Struct({
		sourceLabel: Schema.String,
		kind: Schema.Literal("unresolved"),
		identifierType: Schema.String,
		identifierValue: Schema.String,
		entitySchemaSlug: Schema.String,
	}),
);

export type ImportEntityRef = typeof ImportEntityRef.Type;

export const EpisodeLocator = Schema.Union(
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

export type EpisodeLocator = typeof EpisodeLocator.Type;

const ImportMediaEvent = Schema.Struct({
	occurredAt: Schema.String,
	eventSchemaSlug: Schema.String,
	properties: Schema.Record({ key: Schema.String, value: jsonValueSchema }),
	episodeLocator: Schema.optional(EpisodeLocator),
});

export type ImportMediaEvent = typeof ImportMediaEvent.Type;

export const ImportMediaEntityGroup = Schema.Struct({
	entityRef: ImportEntityRef,
	itemIndex: Schema.Number,
	events: Schema.Array(ImportMediaEvent),
	ownershipProvider: Schema.optional(Schema.String),
	collectionMemberships: Schema.Array(Schema.Struct({ collectionName: Schema.String })),
});

export type ImportMediaEntityGroup = typeof ImportMediaEntityGroup.Type;

export const MediaImportAdapterFailure = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Number,
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
	sourceLabel: Schema.optional(Schema.String),
	sourceIdentifier: Schema.optional(Schema.String),
	context: Schema.optional(Schema.Record({ key: Schema.String, value: jsonValueSchema })),
});

export type MediaImportAdapterFailure = typeof MediaImportAdapterFailure.Type;

export const MediaImportAdapterBatch = Schema.Struct({
	totalItems: Schema.Number,
	failures: Schema.Array(MediaImportAdapterFailure),
	entityGroups: Schema.Array(ImportMediaEntityGroup),
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

export const MediaImportEpisodeResolution = Schema.Struct({
	groupIndex: Schema.Number,
	eventIndex: Schema.Number,
	entityId: Schema.NullOr(Schema.String),
});

export type MediaImportEpisodeResolution = typeof MediaImportEpisodeResolution.Type;

export const MediaImportWriteChunkInput = Schema.Struct({
	failures: Schema.Array(MediaImportAdapterFailure),
	entityGroups: Schema.Array(ImportMediaEntityGroup),
	episodeResolutions: Schema.Array(MediaImportEpisodeResolution),
	populationResults: MediaImportPopulationWorkflowOutput.fields.results,
});

const MediaImportShowEpisodeRef = Schema.Struct({
	seasonNumber: Schema.Int,
	episodeNumber: Schema.Int,
	showEntityId: Schema.String,
	kind: Schema.Literal("show"),
});

const MediaImportPodcastEpisodeRef = Schema.Struct({
	episodeNumber: Schema.Int,
	podcastEntityId: Schema.String,
	kind: Schema.Literal("podcast"),
});

export const MediaImportResolveEpisodesInput = Schema.Struct({
	refs: Schema.Array(Schema.Union(MediaImportShowEpisodeRef, MediaImportPodcastEpisodeRef)),
});

export const MediaImportResolveEpisodesOutput = Schema.Struct({
	results: Schema.Array(Schema.Struct({ entityId: Schema.NullOr(Schema.String) })),
});
