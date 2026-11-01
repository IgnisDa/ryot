import { Schema } from "@ryot-app/plugin-backend-sdk/workflow";

const MetadataLookupData = Schema.Struct({
	identifier: Schema.String,
	source: Schema.Literal("tmdb"),
	lot: Schema.Literals(["movie", "show"]),
});

const MetadataLookupShowInformation = Schema.Struct({ season: Schema.Int, episode: Schema.Int });

const MetadataLookupFound = Schema.Struct({
	title: Schema.String,
	data: MetadataLookupData,
	status: Schema.Literal("found"),
	showInformation: Schema.optional(MetadataLookupShowInformation),
});

const MetadataLookupNotFound = Schema.Struct({
	notFound: Schema.Literal(true),
	status: Schema.Literal("notFound"),
});

export const MetadataLookupResult = Schema.Union([MetadataLookupFound, MetadataLookupNotFound]);

export type MetadataLookupResult = Schema.Schema.Type<typeof MetadataLookupResult>;

export const MetadataLookupInput = Schema.Struct({
	webhookToken: Schema.String,
	titles: Schema.Array(Schema.String),
});

export type MetadataLookupInput = Schema.Schema.Type<typeof MetadataLookupInput>;

export const MetadataLookupOutput = Schema.Struct({ results: Schema.Array(MetadataLookupResult) });

export type MetadataLookupOutput = Schema.Schema.Type<typeof MetadataLookupOutput>;

const ShowEpisodeRef = Schema.Struct({
	index: Schema.Int,
	seasonNumber: Schema.Int,
	episodeNumber: Schema.Int,
	showEntityId: Schema.String,
	kind: Schema.Literal("show"),
});

const ShowSeasonRef = Schema.Struct({
	index: Schema.Int,
	seasonNumber: Schema.Int,
	showEntityId: Schema.String,
	kind: Schema.Literal("show-season"),
});

const PodcastEpisodeRef = Schema.Struct({
	index: Schema.Int,
	episodeNumber: Schema.Int,
	podcastEntityId: Schema.String,
	kind: Schema.Literal("podcast"),
});

const PodcastEpisodeTitleRef = Schema.Struct({
	index: Schema.Int,
	podcastEntityId: Schema.String,
	episodeTitle: Schema.NonEmptyString,
	kind: Schema.Literal("podcast-title"),
});

export const ResolveEpisodesRef = Schema.Union([
	ShowEpisodeRef,
	ShowSeasonRef,
	PodcastEpisodeRef,
	PodcastEpisodeTitleRef,
]);

export type ResolveEpisodesRef = Schema.Schema.Type<typeof ResolveEpisodesRef>;

export const ResolveEpisodesInput = Schema.Struct({ refs: Schema.Array(ResolveEpisodesRef) });

export type ResolveEpisodesInput = Schema.Schema.Type<typeof ResolveEpisodesInput>;

export const ResolveEpisodesOutput = Schema.Struct({
	results: Schema.Array(
		Schema.Struct({ index: Schema.Int, entityId: Schema.NullOr(Schema.String) }),
	),
});

export type ResolveEpisodesOutput = Schema.Schema.Type<typeof ResolveEpisodesOutput>;
