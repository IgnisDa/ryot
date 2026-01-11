import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { trimmedString } from "../../../script-helpers/records";

export const manifest = defineManifest({
	name: "iTunes",
	kind: "provider",
	slug: "podcast.itunes",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	providerInformation: { source: "itunes", canonicalLanguage: "en" },
});
type ItunesHost = SandboxHost<typeof manifest.capabilities>;
type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);
const idString = (value: unknown) => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return typeof value === "string" ? value.trim() : "";
};
const stringValue = (value: unknown) => {
	const parsed = trimmedString(value);
	return parsed.length > 0 ? parsed : null;
};
const truncInt = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
const positiveInt = (value: unknown) => {
	const parsed = truncInt(value);
	return parsed !== null && parsed > 0 ? parsed : null;
};
const resultsArray = (payload: unknown) => {
	const results = asRecord(payload)?.["results"];
	return Array.isArray(results) ? results : [];
};
const ITUNES_LANGUAGE_MAP: Record<string, string> = {
	en: "en_us",
	es: "es_es",
	fr: "fr_fr",
	de: "de_de",
	it: "it_it",
	pt: "pt_br",
	ja: "ja_jp",
	ko: "ko_kr",
	zh: "zh_cn",
	ru: "ru_ru",
	nl: "nl_nl",
};
const bcp47ToItunes = (language: string) => {
	const base = language.trim().toLowerCase().split("-")[0] ?? "";
	return ITUNES_LANGUAGE_MAP[base] ?? base;
};
const getPublishYear = (value: unknown) => {
	const parsed = stringValue(value);
	if (!parsed) {
		return null;
	}
	const parsedDate = DateTime.make(parsed);
	if (Option.isNone(parsedDate)) {
		return null;
	}
	return DateTime.toDateUtc(parsedDate.value).getFullYear();
};
const getIsoDate = (value: unknown) => {
	const parsed = stringValue(value);
	if (!parsed) {
		return null;
	}
	const parsedDate = DateTime.make(parsed);
	if (Option.isNone(parsedDate)) {
		return null;
	}
	return DateTime.formatIsoDateUtc(parsedDate.value);
};
const collectImages = (item: UnknownRecord) => {
	const images: string[] = [];
	for (const key of ["artworkUrl600", "artworkUrl100", "artworkUrl60", "artworkUrl30"]) {
		const image = stringValue(item[key]);
		if (image && !images.includes(image)) {
			images.push(image);
		}
	}
	return images;
};
const collectGenres = (item: UnknownRecord) => {
	const genres = Array.isArray(item["genres"]) ? item["genres"] : [];
	const values = new Set<string>();
	for (const genre of genres) {
		if (typeof genre === "string") {
			const value = genre.trim();
			if (value) {
				values.add(value);
			}
			continue;
		}
		const value = trimmedString(asRecord(genre)?.["name"]);
		if (value) {
			values.add(value);
		}
	}
	return [...values];
};
const buildSourceUrl = (externalId: string, title: string) => {
	const slug = encodeURIComponent(title.toLowerCase().replace(/\s+/g, "-"));
	return `https://podcasts.apple.com/us/podcast/${slug}/id${externalId}`;
};
const parseJsonResponse = (responseBody: string): unknown => {
	try {
		return JSON.parse(responseBody);
	} catch {
		throw new Error("iTunes returned invalid JSON");
	}
};
const itunesGet = (
	host: ItunesHost,
	endpoint: "lookup" | "search",
	params: Record<string, string>,
	failureMessage: string,
) => {
	const search = new URLSearchParams(params);
	return host.httpCall("GET", `https://itunes.apple.com/${endpoint}?${search.toString()}`).pipe(
		Effect.mapError((error) => new Error(error.message || failureMessage)),
		Effect.flatMap((response) =>
			Effect.try({
				try: () => parseJsonResponse(response.body),
				catch: (error) => (error instanceof Error ? error : new Error(String(error))),
			}),
		),
	);
};
const lookup = (host: ItunesHost, params: Record<string, string>) =>
	itunesGet(host, "lookup", params, "iTunes lookup request failed");
const translationResult = (item: UnknownRecord | null, nameKey: string, missing: string) => {
	if (!item) {
		throw new Error(missing);
	}
	const name = stringValue(item[nameKey]);
	if (!name) {
		throw new Error(
			`iTunes ${nameKey === "collectionName" ? "podcast" : "podcast episode"} is missing title`,
		);
	}
	const description = stringValue(item["description"]);
	return {
		name,
		...(description ? { properties: { description } } : {}),
	};
};
export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const resultLimit = Math.min(input.page * input.pageSize, 200);
	return itunesGet(
		host,
		"search",
		{
			term: input.query,
			media: "podcast",
			entity: "podcast",
			lang: "en_us",
			limit: String(resultLimit),
		},
		"iTunes search request failed",
	).pipe(
		Effect.map((payload) => {
			const results = resultsArray(payload);
			const totalItems = results.length;
			const pagedResults = results.slice(
				(input.page - 1) * input.pageSize,
				input.page * input.pageSize,
			);
			const items = pagedResults.flatMap((raw) => {
				const item = asRecord(raw);
				const externalId = idString(item?.["collectionId"]);
				const title = trimmedString(item?.["collectionName"]);
				if (!item || !externalId || !title) {
					return [];
				}
				const image = collectImages(item)[0] ?? null;
				const publishYear = getPublishYear(item["releaseDate"]);
				return [
					{
						externalId,
						titleProperty: { kind: "text" as const, value: title },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty:
							image === null
								? { kind: "null" as const, value: null }
								: { kind: "image" as const, value: { type: "remote" as const, url: image } },
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
					},
				];
			});
			return {
				items,
				details: {
					totalItems,
					nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
				},
			};
		}),
	);
});
type MappedEpisode = {
	id: string;
	title: string;
	number: number;
	publishDate: string;
	runtime: number | null;
	overview: string | null;
	thumbnail: string | null;
};
export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const language = bcp47ToItunes(manifest.providerInformation.canonicalLanguage);
	return lookup(host, {
		id: input.externalId,
		media: "podcast",
		entity: "podcast",
		lang: language,
	}).pipe(
		Effect.flatMap((detailsPayload) =>
			Effect.gen(function* () {
				const podcast = asRecord(resultsArray(detailsPayload)[0]);
				if (!podcast) {
					return yield* Effect.fail(new Error("Podcast not found"));
				}
				const title = trimmedString(podcast["collectionName"]);
				if (!title) {
					return yield* Effect.fail(new Error("Podcast is missing title"));
				}
				const totalEpisodes = positiveInt(podcast["trackCount"]);
				const episodeLookup: Record<string, string> = {
					id: input.externalId,
					media: "podcast",
					entity: "podcastEpisode",
					lang: language,
				};
				if (totalEpisodes !== null) {
					episodeLookup["limit"] = String(totalEpisodes);
				}
				return yield* lookup(host, episodeLookup).pipe(
					Effect.map((episodesPayload) => {
						const unlinkedCreators: Array<{
							role: string;
							name: string;
						}> = [];
						const artistName = trimmedString(podcast["artistName"]);
						if (artistName) {
							unlinkedCreators.push({ role: "Artist", name: artistName });
						}
						const episodes = resultsArray(episodesPayload)
							.flatMap((raw): MappedEpisode[] => {
								const episode = asRecord(raw);
								const id = idString(episode?.["trackId"]);
								const episodeTitle = trimmedString(episode?.["trackName"]);
								const publishDate = getIsoDate(episode?.["releaseDate"]);
								if (!episode || !id || !episodeTitle || !publishDate) {
									return [];
								}
								const runtimeMillis = episode["trackTimeMillis"];
								return [
									{
										id,
										publishDate,
										number: 0,
										title: episodeTitle,
										overview: stringValue(episode["description"]),
										thumbnail:
											stringValue(episode["artworkUrl600"]) ??
											stringValue(episode["artworkUrl100"]) ??
											stringValue(episode["artworkUrl60"]) ??
											stringValue(episode["artworkUrl30"]),
										runtime:
											typeof runtimeMillis === "number" && Number.isFinite(runtimeMillis)
												? Math.trunc(runtimeMillis / 1000 / 60)
												: null,
									},
								];
							})
							.sort((left, right) => {
								const publishDateDiff = left.publishDate.localeCompare(right.publishDate);
								return publishDateDiff !== 0 ? publishDateDiff : left.id.localeCompare(right.id);
							})
							.map((episode, index) => {
								episode.number = index + 1;
								return episode;
							});
						const childEntities = episodes.map((episode) => ({
							entitySchemaSlug: "podcast-episode",
							externalId: episode.id,
							name: episode.title || `Episode ${episode.number}`,
							properties: {
								runtime: episode.runtime,
								description: episode.overview,
								episodeNumber: episode.number,
								publishDate: episode.publishDate,
								parentPodcastExternalId: input.externalId,
								...(episode.thumbnail
									? { images: [{ type: "remote", url: episode.thumbnail }] }
									: {}),
							},
						}));
						return {
							name: title,
							childEntities,
							properties: {
								publishDate: getIsoDate(podcast["releaseDate"]),
								publishYear: getPublishYear(podcast["releaseDate"]),
								unlinkedCreators,
								genres: collectGenres(podcast),
								sourceUrl: buildSourceUrl(input.externalId, title),
								totalEpisodes: totalEpisodes ?? episodes.length,
								description: stringValue(podcast["description"]),
								images: collectImages(podcast).map((url) => ({ type: "remote" as const, url })),
							},
						};
					}),
				);
			}),
		),
	);
});
const findPodcastEpisode = (payload: unknown, externalId: string) => {
	for (const raw of resultsArray(payload)) {
		const item = asRecord(raw);
		if (item && idString(item["trackId"]) === externalId) {
			return item;
		}
	}
	return null;
};
export const translate = defineProviderDriver(manifest, "translate", (input, host) => {
	const providerLanguage = bcp47ToItunes(input.language);
	if (input.entitySchemaSlug === "podcast") {
		return lookup(host, {
			id: input.externalId,
			media: "podcast",
			entity: "podcast",
			lang: providerLanguage,
		}).pipe(
			Effect.flatMap((payload) =>
				Effect.try({
					try: () =>
						translationResult(
							asRecord(resultsArray(payload)[0]),
							"collectionName",
							"iTunes podcast not found",
						),
					catch: (error) => (error instanceof Error ? error : new Error(String(error))),
				}),
			),
		);
	}
	if (input.entitySchemaSlug === "podcast-episode") {
		const parentPodcastExternalId = stringValue(
			asRecord(input.properties)?.["parentPodcastExternalId"],
		);
		if (!parentPodcastExternalId) {
			return Effect.fail(
				new Error("parentPodcastExternalId is required for iTunes episode translation"),
			);
		}
		return lookup(host, {
			limit: "200",
			media: "podcast",
			lang: providerLanguage,
			entity: "podcastEpisode",
			id: parentPodcastExternalId,
		}).pipe(
			Effect.flatMap((payload) =>
				Effect.try({
					try: () =>
						translationResult(
							findPodcastEpisode(payload, input.externalId),
							"trackName",
							"iTunes podcast episode not found",
						),
					catch: (error) => (error instanceof Error ? error : new Error(String(error))),
				}),
			),
		);
	}
	return Effect.fail(
		new Error("podcast.itunes translate supports only podcast and podcast-episode"),
	);
});
export default defineProvider({ manifest, drivers: { search, details, translate } });
