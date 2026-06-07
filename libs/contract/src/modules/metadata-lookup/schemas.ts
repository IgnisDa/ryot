import { Schema } from "effect";

const MetadataLookupLot = Schema.Literal("movie", "show");

export const MetadataLookupBody = Schema.Struct({ title: Schema.String });

export type MetadataLookupBody = typeof MetadataLookupBody.Type;

const MetadataLookupData = Schema.Struct({
	lot: MetadataLookupLot,
	identifier: Schema.String,
	source: Schema.Literal("tmdb"),
});

const MetadataLookupShowInformation = Schema.Struct({
	season: Schema.Int,
	episode: Schema.Int,
});

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

export const MetadataLookupResponse = Schema.Union(MetadataLookupFound, MetadataLookupNotFound);

export type MetadataLookupResponse = typeof MetadataLookupResponse.Type;
