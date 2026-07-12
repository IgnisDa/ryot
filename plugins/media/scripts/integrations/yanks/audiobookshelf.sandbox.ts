import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Option, Schema } from "@ryot/sandbox-sdk/effect";

import type { EntityRef } from "../shared";
import { AdapterResult, baseUrl, requestJson, sourceFailure, specifics } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Audiobookshelf yank",
	slug: "integration.audiobookshelf",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getIntegration"],
});
const Input = Schema.Struct({});
const Metadata = Schema.Struct({
	title: Schema.String,
	asin: Schema.optional(Schema.NullOr(Schema.String)),
	isbn: Schema.optional(Schema.NullOr(Schema.String)),
	itunesId: Schema.optional(Schema.NullOr(Schema.String)),
});
const Episode = Schema.Struct({
	id: Schema.optional(Schema.String),
	index: Schema.optional(Schema.Number),
	number: Schema.optional(Schema.Number),
	episode: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
	sequence: Schema.optional(Schema.Number),
	episodeNumber: Schema.optional(Schema.Number),
});
const Progress = Schema.Struct({ isFinished: Schema.optional(Schema.Boolean) });
const Item = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	mediaType: Schema.optional(Schema.Literal("book", "podcast")),
	media: Schema.optional(
		Schema.Struct({
			metadata: Schema.optional(Metadata),
			ebookFormat: Schema.optional(Schema.NullOr(Schema.String)),
			episodes: Schema.optional(Schema.Array(Episode)),
		}),
	),
	userMediaProgress: Schema.optional(Progress),
});
const LibrariesResponse = Schema.Struct({
	libraries: Schema.optional(
		Schema.Array(
			Schema.Struct({
				id: Schema.String,
				name: Schema.optional(Schema.String),
				mediaType: Schema.optional(Schema.Literal("book", "podcast")),
			}),
		),
	),
});
const ListingResponse = Schema.Struct({ results: Schema.optional(Schema.Array(Item)) });
const DetailsResponse = Schema.Struct({
	media: Schema.optional(Schema.Struct({ episodes: Schema.optional(Schema.Array(Episode)) })),
});
const ProgressResponse = Schema.Struct({ userMediaProgress: Schema.optional(Progress) });
const validIsbn = (value: string) => {
	if (/^\d{13}$/.test(value)) {
		const sum = value
			.slice(0, 12)
			.split("")
			.reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
		return (sum + Number(value[12])) % 10 === 0;
	}
	if (/^\d{9}[\dX]$/.test(value)) {
		const sum = value.split("").reduce((total, digit, index) => {
			const number = digit === "X" ? 10 : Number(digit);
			return total + number * (10 - index);
		}, 0);
		return sum % 11 === 0;
	}
	return false;
};
const itemRef = (item: typeof Item.Type): EntityRef | null => {
	const metadata = item.media?.metadata;
	if (!metadata) {
		return null;
	}
	if (item.media.ebookFormat === "epub" && typeof metadata.isbn === "string") {
		const isbn = metadata.isbn.replace(/[^0-9X]/gi, "").toUpperCase();
		if (validIsbn(isbn)) {
			return {
				kind: "unresolved",
				sourceLabel: metadata.title,
				identifierValue: isbn,
				identifierType: "isbn",
				entitySchemaSlug: "book",
			};
		}
	}
	if (typeof metadata.asin === "string" && metadata.asin.trim()) {
		return {
			kind: "resolved",
			sourceLabel: metadata.title,
			externalId: metadata.asin.trim(),
			entitySchemaSlug: "audiobook",
			providerSlug: "audiobook.audible",
		};
	}
	if (typeof metadata.itunesId === "string" && metadata.itunesId.trim()) {
		return {
			kind: "resolved",
			sourceLabel: metadata.title,
			externalId: metadata.itunesId.trim(),
			entitySchemaSlug: "podcast",
			providerSlug: "podcast.itunes",
		};
	}
	return null;
};
export default defineScript({
	manifest,
	input: Input,
	output: AdapterResult,
	run: (_input, host) =>
		Effect.gen(function* () {
			const integration = yield* host.getIntegration();
			const settings = specifics(integration.providerSpecifics);
			const token = typeof settings?.["token"] === "string" ? settings["token"] : "";
			const root = baseUrl(settings?.["baseUrl"]);
			const url = root.endsWith("/api") ? root : `${root}/api`;
			const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
			const libraries = yield* requestJson(host, "GET", `${url}/libraries`, { headers }).pipe(
				Effect.flatMap(Schema.decodeUnknown(LibrariesResponse)),
			);
			const failures: Array<AdapterResult["failures"][number]> = [];
			const entityGroups: Array<AdapterResult["entityGroups"][number]> = [];
			const importedAt = new Date().toISOString();
			let itemIndex = 0;
			for (const library of libraries.libraries ?? []) {
				const filter = library.mediaType === "book" ? "&filter=progress.ZmluaXNoZWQ=" : "";
				const listingResult = yield* requestJson(
					host,
					"GET",
					`${url}/libraries/${library.id}/items?expanded=1${filter}`,
					{ headers },
				).pipe(Effect.flatMap(Schema.decodeUnknown(ListingResponse)), Effect.option);
				if (Option.isNone(listingResult)) {
					failures.push(
						sourceFailure({
							itemIndex,
							sourceLabel: library.name,
							sourceIdentifier: library.id,
							message: "Failed to fetch Audiobookshelf library items",
						}),
					);
				}
				const listing = Option.getOrElse(listingResult, () => ({ results: [] }));
				for (const item of listing.results ?? []) {
					const currentIndex = itemIndex++;
					const ref = itemRef(item);
					if (!ref) {
						let message = "Audiobookshelf item is missing media metadata";
						if (item.media?.metadata) {
							message =
								item.media.ebookFormat === "epub"
									? "Audiobookshelf ebook is missing a valid ISBN"
									: "Audiobookshelf item has no Audible, ISBN, or iTunes identifier";
						}
						failures.push({
							itemIndex: currentIndex,
							stage: "input_transformation",
							message,
							sourceLabel: item.media?.metadata?.title ?? item.name,
							sourceIdentifier: item.id,
						});
						continue;
					}
					const events: Array<AdapterResult["entityGroups"][number]["events"][number]> = [];
					const occurredAt = importedAt;
					if (ref.entitySchemaSlug !== "podcast") {
						events.push({
							occurredAt,
							eventSchemaSlug: "complete",
							properties: { completedOn: occurredAt, completionMode: "custom_timestamps" },
						});
					} else {
						const detailsResult = yield* requestJson(
							host,
							"GET",
							`${url}/items/${item.id}?expanded=1&include=progress`,
							{ headers },
						).pipe(Effect.flatMap(Schema.decodeUnknown(DetailsResponse)), Effect.option);
						if (Option.isNone(detailsResult)) {
							failures.push(
								sourceFailure({
									itemIndex: currentIndex,
									sourceLabel: ref.sourceLabel,
									sourceIdentifier: item.id,
									message: "Failed to fetch Audiobookshelf podcast details",
								}),
							);
						}
						const details = Option.getOrNull(detailsResult);
						if (details && (details.media?.episodes ?? []).length === 0) {
							failures.push({
								itemIndex: currentIndex,
								stage: "input_transformation",
								message: "Audiobookshelf podcast has no episodes",
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: item.id,
							});
						}
						for (const episode of details?.media?.episodes ?? []) {
							if (episode.id) {
								const progressResult = yield* requestJson(
									host,
									"GET",
									`${url}/items/${item.id}?expanded=1&include=progress&episode=${episode.id}`,
									{ headers },
								).pipe(Effect.flatMap(Schema.decodeUnknown(ProgressResponse)), Effect.option);
								if (Option.isNone(progressResult)) {
									failures.push(
										sourceFailure({
											itemIndex: currentIndex,
											sourceLabel: ref.sourceLabel,
											sourceIdentifier: item.id,
											message: "Failed to fetch Audiobookshelf podcast episode progress",
										}),
									);
									continue;
								}
								const progress = progressResult.value;
								const number =
									episode.episodeNumber ??
									episode.number ??
									episode.index ??
									episode.sequence ??
									(typeof episode.episode === "number"
										? episode.episode
										: Number.parseInt(episode.episode ?? "", 10));
								if (progress.userMediaProgress?.isFinished && Number.isInteger(number)) {
									events.push({
										occurredAt,
										eventSchemaSlug: "progress",
										properties: { progressPercent: 100 },
										episodeLocator: { type: "podcast", episodeNumber: number },
									});
								}
							}
						}
						if (details && (details.media?.episodes ?? []).length > 0 && events.length === 0) {
							failures.push({
								itemIndex: currentIndex,
								stage: "input_transformation",
								message:
									"Audiobookshelf podcast has no finished episodes with importable episode numbers",
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: item.id,
							});
						}
					}
					if (events.length) {
						entityGroups.push({
							entityRef: ref,
							events,
							itemIndex: currentIndex,
							collectionMemberships: library.name?.trim()
								? [{ collectionName: library.name.trim() }]
								: [],
						});
					}
				}
				if (integration.syncOwnership) {
					const ownedResult = yield* requestJson(
						host,
						"GET",
						`${url}/libraries/${library.id}/items?expanded=1`,
						{ headers },
					).pipe(Effect.flatMap(Schema.decodeUnknown(ListingResponse)), Effect.option);
					if (Option.isSome(ownedResult)) {
						for (const item of ownedResult.value.results ?? []) {
							const ref = itemRef(item);
							if (ref) {
								entityGroups.push({
									entityRef: ref,
									events: [],
									itemIndex: itemIndex++,
									collectionMemberships: [],
									ownershipProvider: "audiobookshelf",
								});
							}
						}
					}
				}
			}
			return { failures, entityGroups };
		}),
});
