import { Schema } from "@ryot-app/plugin-kit/effect";
import { IsoDateString, JsonValue } from "@ryot-app/plugin-kit/ryotql";

export const UnresolvedEpisodeRef = Schema.Union([
	Schema.Struct({ seasonNumber: Schema.Int, type: Schema.Literal("show-season") }),
	Schema.Struct({
		seasonNumber: Schema.Int,
		episodeNumber: Schema.Int,
		type: Schema.Literal("show"),
	}),
	Schema.Struct({ episodeNumber: Schema.Int, type: Schema.Literal("podcast") }),
	Schema.Struct({ episodeTitle: Schema.NonEmptyString, type: Schema.Literal("podcast-title") }),
]);

export type UnresolvedEpisodeRef = typeof UnresolvedEpisodeRef.Type;

export const MediaHistoryEvent = Schema.Struct({
	occurredAt: IsoDateString,
	eventSchemaSlug: Schema.NonEmptyString,
	episode: Schema.optional(UnresolvedEpisodeRef),
	properties: Schema.Record(Schema.String, JsonValue),
});

export const MediaHistoryItem = Schema.Struct({
	title: Schema.String,
	externalId: Schema.NonEmptyString,
	providerSlug: Schema.NonEmptyString,
	entitySchemaSlug: Schema.NonEmptyString,
	events: Schema.Array(MediaHistoryEvent),
});

export type MediaHistoryItem = typeof MediaHistoryItem.Type;

export const MediaHistoryDocument = Schema.Array(MediaHistoryItem);
