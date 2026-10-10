import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { getOccurredAtValue, parseDateInput } from "./dates";
import {
	createBacklogEvent,
	createCompleteEvent,
	createDroppedEvent,
	createOnHoldEvent,
	createProgressEvent,
	toTitleCaseWords,
} from "./helpers";
import type { ImportEntityRef } from "./schemas";

const MediaType = Schema.Literals(["audiobook", "book", "movie", "tv", "video_game"]);
export const Item = Schema.Struct({ id: Schema.Int, mediaType: Schema.optional(MediaType) });
export const List = Schema.Struct({
	id: Schema.Int,
	name: Schema.String,
	description: Schema.optional(Schema.NullOr(Schema.String)),
});
const Episode = Schema.Struct({
	id: Schema.Int,
	seasonNumber: Schema.Int,
	episodeNumber: Schema.Int,
});
const Season = Schema.Struct({
	episodes: Schema.Array(Episode).pipe(
		Schema.withDecodingDefault(Effect.succeed<ReadonlyArray<typeof Episode.Type>>([])),
		Schema.withConstructorDefault(Effect.sync(() => [])),
	),
});
const SeenHistory = Schema.Struct({
	id: Schema.Int,
	episodeId: Schema.optional(Schema.NullOr(Schema.Int)),
	date: Schema.optional(Schema.NullOr(Schema.Union([Schema.Finite, Schema.String]))),
});
export const Details = Schema.Struct({
	id: Schema.Int,
	name: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	igdbId: Schema.optional(Schema.NullOr(Schema.Int)),
	tmdbId: Schema.optional(Schema.NullOr(Schema.Int)),
	asin: Schema.optional(Schema.NullOr(Schema.String)),
	goodreadsId: Schema.optional(Schema.NullOr(Schema.Int)),
	audibleId: Schema.optional(Schema.NullOr(Schema.String)),
	openlibraryId: Schema.optional(Schema.NullOr(Schema.String)),
	seasons: Schema.Array(Season).pipe(
		Schema.withDecodingDefault(Effect.succeed<ReadonlyArray<typeof Season.Type>>([])),
		Schema.withConstructorDefault(Effect.sync(() => [])),
	),
	seenHistory: Schema.Array(SeenHistory).pipe(
		Schema.withDecodingDefault(Effect.succeed<ReadonlyArray<typeof SeenHistory.Type>>([])),
		Schema.withConstructorDefault(Effect.sync(() => [])),
	),
	userRating: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				id: Schema.Int,
				rating: Schema.optional(Schema.NullOr(Schema.Finite)),
				review: Schema.optional(Schema.NullOr(Schema.String)),
				date: Schema.optional(Schema.NullOr(Schema.Union([Schema.Finite, Schema.String]))),
			}),
		),
	),
});
export const label = (id: number, type: typeof MediaType.Type, details: typeof Details.Type) =>
	details.title ?? details.name ?? `${toTitleCaseWords(type)} ${id}`;
export const fallbackDate = (details: typeof Details.Type, importedAt: string) =>
	[
		...details.seenHistory.map((seen) => parseDateInput(seen.date)),
		parseDateInput(details.userRating?.date),
	]
		.filter((value): value is string => Boolean(value))
		.sort((left, right) => getOccurredAtValue(right) - getOccurredAtValue(left))[0] ?? importedAt;
export const entityRef = (
	details: typeof Details.Type,
	type: typeof MediaType.Type,
	sourceLabel: string,
): ImportEntityRef | "goodreads" | null => {
	if (type === "movie" || type === "tv") {
		return details.tmdbId
			? {
					sourceLabel,
					kind: "resolved",
					externalId: String(details.tmdbId),
					entitySchemaSlug: type === "movie" ? "movie" : "show",
					providerSlug: type === "movie" ? "movie.tmdb" : "show.tmdb",
				}
			: null;
	}
	if (type === "video_game") {
		return details.igdbId
			? {
					sourceLabel,
					kind: "resolved",
					entitySchemaSlug: "video-game",
					providerSlug: "video-game.igdb",
					externalId: String(details.igdbId),
				}
			: null;
	}
	if (type === "audiobook") {
		const id = details.audibleId?.trim();
		return id
			? {
					sourceLabel,
					externalId: id,
					kind: "resolved",
					entitySchemaSlug: "audiobook",
					providerSlug: "audiobook.audible",
				}
			: null;
	}
	if (details.goodreadsId) {
		return "goodreads";
	}
	const idSegments = details.openlibraryId?.trim().split("/");
	let id = idSegments?.pop();
	while (id === "") {
		id = idSegments?.pop();
	}
	return id
		? {
				sourceLabel,
				externalId: id,
				kind: "resolved",
				entitySchemaSlug: "book",
				providerSlug: "book.openlibrary",
			}
		: null;
};
export const lifecycleEvent = (lifecycle: string, occurredAt: string) => {
	if (lifecycle === "backlog") {
		return createBacklogEvent(occurredAt);
	}
	if (lifecycle === "progress") {
		return createProgressEvent(occurredAt);
	}
	if (lifecycle === "dropped") {
		return createDroppedEvent({ occurredAt });
	}
	if (lifecycle === "on_hold") {
		return createOnHoldEvent({ occurredAt });
	}
	if (lifecycle === "complete") {
		return createCompleteEvent({ occurredAt, completedOn: occurredAt });
	}
	return null;
};
