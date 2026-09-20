import { Schema } from "@ryot-app/sandbox-sdk/effect";

import { isValidIsbn, normalizeIsbn } from "./helpers";
import type { ImportEntityRef } from "./schemas";

const Episode = Schema.Struct({
	title: Schema.String,
	id: Schema.optional(Schema.String),
	index: Schema.optional(Schema.Int),
	number: Schema.optional(Schema.Int),
	sequence: Schema.optional(Schema.Int),
	episodeNumber: Schema.optional(Schema.Int),
	episode: Schema.optional(Schema.Union([Schema.Int, Schema.String])),
});
const Progress = Schema.optional(
	Schema.Struct({
		progress: Schema.optional(Schema.Finite),
		isFinished: Schema.optional(Schema.Boolean),
		ebookProgress: Schema.optional(Schema.Finite),
	}),
);
export const Item = Schema.Struct({
	id: Schema.String,
	userMediaProgress: Progress,
	name: Schema.optional(Schema.String),
	mediaType: Schema.optional(Schema.Literals(["book", "podcast"])),
	media: Schema.optional(
		Schema.Struct({
			episodes: Schema.optional(Schema.Array(Episode)),
			ebookFormat: Schema.optional(Schema.NullOr(Schema.String)),
			metadata: Schema.Struct({
				title: Schema.String,
				asin: Schema.optional(Schema.NullOr(Schema.String)),
				isbn: Schema.optional(Schema.NullOr(Schema.String)),
				itunesId: Schema.optional(Schema.NullOr(Schema.String)),
			}),
		}),
	),
});
export const Libraries = Schema.Struct({
	libraries: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			name: Schema.optional(Schema.String),
			mediaType: Schema.optional(Schema.Literals(["book", "podcast"])),
		}),
	),
});
export const Listing = Schema.Struct({ results: Schema.Array(Item) });
export const episodeNumber = (episode: typeof Episode.Type) => {
	const value =
		episode.episodeNumber ?? episode.number ?? episode.index ?? episode.sequence ?? episode.episode;
	if (typeof value === "number") {
		return value;
	}
	if (typeof value !== "string") {
		return null;
	}
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) ? parsed : null;
};
export const itemRef = (item: typeof Item.Type): ImportEntityRef | null => {
	const metadata = item.media?.metadata;
	if (!metadata) {
		return null;
	}
	if (item.media.ebookFormat === "epub") {
		const isbn = metadata.isbn ? normalizeIsbn(metadata.isbn) : "";
		return isbn && isValidIsbn(isbn)
			? {
					kind: "unresolved",
					identifierValue: isbn,
					identifierType: "isbn",
					entitySchemaSlug: "book",
					sourceLabel: metadata.title,
				}
			: null;
	}
	const asin = metadata.asin?.trim();
	if (asin) {
		return {
			kind: "resolved",
			externalId: asin,
			sourceLabel: metadata.title,
			entitySchemaSlug: "audiobook",
			providerSlug: "audiobook.audible",
		};
	}
	const itunesId = metadata.itunesId?.trim();
	return itunesId
		? {
				kind: "resolved",
				externalId: itunesId,
				sourceLabel: metadata.title,
				entitySchemaSlug: "podcast",
				providerSlug: "podcast.itunes",
			}
		: null;
};
