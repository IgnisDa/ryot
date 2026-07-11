import { Effect, Either, Schema } from "@ryot/sandbox-sdk/effect";

import { nowIso } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	addCollectionMembership,
	createCompleteEvent,
	finalizeEntityGroups,
	isValidIsbn,
	normalizeIsbn,
} from "./helpers";
import type { ImportEntityRef, ImportMediaEvent, MediaImportAdapterFailure } from "./schemas";
import {
	requestSourceJson,
	sourceApiHost,
	withSourceRequestOptions,
	type HttpHost,
} from "./source-api";
import { sourceFetchFailure } from "./source-helpers";

const FINISHED_FILTER = "ZmluaXNoZWQ=";
const Episode = Schema.Struct({
	title: Schema.String,
	id: Schema.optional(Schema.String),
	index: Schema.optional(Schema.Int),
	number: Schema.optional(Schema.Int),
	sequence: Schema.optional(Schema.Int),
	episodeNumber: Schema.optional(Schema.Int),
	episode: Schema.optional(Schema.Union(Schema.Int, Schema.String)),
});
type Episode = typeof Episode.Type;
const Progress = Schema.optional(
	Schema.Struct({
		progress: Schema.optional(Schema.Number),
		isFinished: Schema.optional(Schema.Boolean),
		ebookProgress: Schema.optional(Schema.Number),
	}),
);
const Item = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	userMediaProgress: Progress,
	mediaType: Schema.optional(Schema.Literal("book", "podcast")),
	media: Schema.optional(
		Schema.Struct({
			ebookFormat: Schema.optional(Schema.NullOr(Schema.String)),
			episodes: Schema.optional(Schema.Array(Episode)),
			metadata: Schema.Struct({
				title: Schema.String,
				asin: Schema.optional(Schema.NullOr(Schema.String)),
				isbn: Schema.optional(Schema.NullOr(Schema.String)),
				itunesId: Schema.optional(Schema.NullOr(Schema.String)),
			}),
		}),
	),
});
const Libraries = Schema.Struct({
	libraries: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			name: Schema.optional(Schema.String),
			mediaType: Schema.optional(Schema.Literal("book", "podcast")),
		}),
	),
});
const Listing = Schema.Struct({ results: Schema.Array(Item) });

const episodeNumber = (episode: Episode) => {
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

const itemRef = (item: typeof Item.Type): ImportEntityRef | null => {
	const metadata = item.media?.metadata;
	if (!metadata) {
		return null;
	}
	if (item.media.ebookFormat === "epub") {
		const isbn = metadata.isbn ? normalizeIsbn(metadata.isbn) : "";
		return isbn && isValidIsbn(isbn)
			? {
					kind: "unresolved",
					identifierType: "isbn",
					identifierValue: isbn,
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
			entitySchemaSlug: "audiobook",
			sourceLabel: metadata.title,
			providerSlug: "audiobook.audible",
		};
	}
	const itunesId = metadata.itunesId?.trim();
	return itunesId
		? {
				kind: "resolved",
				externalId: itunesId,
				entitySchemaSlug: "podcast",
				sourceLabel: metadata.title,
				providerSlug: "podcast.itunes",
			}
		: null;
};

export const adaptAudiobookshelfData = (
	input: { apiKey: string; apiUrl: string; allowInsecureConnections?: boolean | undefined },
	host: HttpHost,
) =>
	Effect.gen(function* () {
		const requestHost = withSourceRequestOptions(host, input.allowInsecureConnections);
		const importedAt = nowIso();
		const headers = { Accept: "application/json", Authorization: `Bearer ${input.apiKey}` };
		const baseUrl = normalizeApiPath(input.apiUrl);
		const hostName = sourceApiHost(input.apiUrl);
		const failures: MediaImportAdapterFailure[] = [];
		const groups = new Map<string, ImportMediaEntityGroupBuilder>();
		const libraries = yield* requestSourceJson(requestHost, {
			headers,
			baseUrl,
			path: "libraries",
		}).pipe(Effect.flatMap(Schema.decodeUnknown(Libraries)));
		let itemIndex = 0;
		for (const library of libraries.libraries) {
			const listing = yield* requestSourceJson(requestHost, {
				headers,
				baseUrl,
				path: `libraries/${library.id}/items`,
				query: {
					expanded: 1,
					...(library.mediaType === "book" ? { filter: `progress.${FINISHED_FILTER}` } : {}),
				},
			}).pipe(Effect.flatMap(Schema.decodeUnknown(Listing)), Effect.either);
			if (Either.isLeft(listing)) {
				failures.push(
					sourceFetchFailure({
						host: hostName,
						itemIndex,
						sourceLabel: library.name,
						sourceIdentifier: library.id,
						message: "Failed to fetch Audiobookshelf library items",
					}),
				);
				continue;
			}
			for (const item of listing.right.results) {
				const currentIndex = itemIndex++;
				const metadata = item.media?.metadata;
				const ref = itemRef(item);
				if (!ref) {
					let message = "Audiobookshelf item is missing media metadata";
					if (metadata) {
						message =
							item.media.ebookFormat === "epub"
								? "Audiobookshelf ebook is missing a valid ISBN"
								: "Audiobookshelf item has no Audible, ISBN, or iTunes identifier";
					}
					failures.push({
						message,
						itemIndex: currentIndex,
						sourceLabel: metadata?.title ?? item.name,
						sourceIdentifier: item.id,
						stage: "input_transformation",
					});
					continue;
				}
				const events: ImportMediaEvent[] = [];
				if (ref.entitySchemaSlug !== "podcast") {
					events.push(createCompleteEvent({ occurredAt: importedAt, completedOn: importedAt }));
				} else {
					const details = yield* requestSourceJson(requestHost, {
						headers,
						baseUrl,
						path: `items/${item.id}`,
						query: { expanded: 1, include: "progress" },
					}).pipe(Effect.flatMap(Schema.decodeUnknown(Item)), Effect.either);
					if (Either.isLeft(details)) {
						failures.push(
							sourceFetchFailure({
								host: hostName,
								itemIndex: currentIndex,
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: item.id,
								message: "Failed to fetch Audiobookshelf podcast details",
							}),
						);
						continue;
					}
					const episodes = details.right.media?.episodes ?? [];
					if (episodes.length === 0) {
						failures.push({
							itemIndex: currentIndex,
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: item.id,
							stage: "input_transformation",
							message: "Audiobookshelf podcast has no episodes",
						});
						continue;
					}
					for (const episode of episodes) {
						if (!episode.id) {
							continue;
						}
						const progress = yield* requestSourceJson(requestHost, {
							headers,
							baseUrl,
							path: `items/${item.id}`,
							query: { expanded: 1, include: "progress", episode: episode.id },
						}).pipe(Effect.flatMap(Schema.decodeUnknown(Item)), Effect.either);
						if (Either.isLeft(progress)) {
							failures.push(
								sourceFetchFailure({
									host: hostName,
									itemIndex: currentIndex,
									sourceLabel: ref.sourceLabel,
									sourceIdentifier: item.id,
									message: "Failed to fetch Audiobookshelf podcast episode progress",
								}),
							);
							continue;
						}
						const number = episodeNumber(episode);
						if (progress.right.userMediaProgress?.isFinished && number != null) {
							events.push({
								occurredAt: importedAt,
								eventSchemaSlug: "progress",
								properties: { progressPercent: 100 },
								unresolvedEpisode: { type: "podcast", episodeNumber: number },
							});
						}
					}
					if (events.length === 0) {
						failures.push({
							itemIndex: currentIndex,
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: item.id,
							stage: "input_transformation",
							message:
								"Audiobookshelf podcast has no finished episodes with importable episode numbers",
						});
						continue;
					}
				}
				const group = getOrCreateMediaEntityGroup(groups, ref, currentIndex);
				group.events.push(...events);
				if (library.name?.trim()) {
					addCollectionMembership(group, library.name);
				}
			}
		}
		return { failures, totalItems: itemIndex, entityGroups: finalizeEntityGroups(groups.values()) };
	});

const normalizeApiPath = (apiUrl: string) =>
	apiUrl.replace(/\/+$/, "").endsWith("/api") ? apiUrl : `${apiUrl.replace(/\/+$/, "")}/api`;
