import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { DateTime, Effect, Option } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../../../lib/failures";
import { mediaGenreGroups } from "../../../lib/media-genres";
import { decodeJsonResponse, trimmedString } from "../../../lib/records";
import { normalizeRichDescription } from "../../../lib/rich-description";

export const manifest = defineManifest({
	name: "iTunes",
	kind: "provider",
	slug: "podcast.itunes",
});
type UnknownRecord = Record<string, unknown>;
type ItunesHost = Pick<ScriptHost, "httpCall">;
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
const collectGenres = Effect.fnUntraced(function* (item: UnknownRecord) {
	const rawGenres = item["genres"];
	if (rawGenres === undefined || rawGenres === null) {
		return null;
	}
	if (!Array.isArray(rawGenres)) {
		return yield* new MediaSandboxError({ message: "iTunes genres must be an array" });
	}
	const genres = rawGenres;
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
});
const buildSourceUrl = (externalId: string, title: string) => {
	const slug = encodeURIComponent(title.toLowerCase().replace(/\s+/g, "-"));
	return `https://podcasts.apple.com/us/podcast/${slug}/id${externalId}`;
};
const itunesGet = (
	host: ItunesHost,
	endpoint: "lookup" | "search",
	params: Record<string, string>,
	failureMessage: string,
) => {
	const search = new URLSearchParams(params);
	return host.httpCall("GET", `https://itunes.apple.com/${endpoint}?${search.toString()}`).pipe(
		Effect.mapError((error) => ({ ...error, message: error.message || failureMessage })),
		Effect.flatMap((response) => decodeJsonResponse(response.body, "iTunes")),
	);
};
const lookup = (host: ItunesHost, params: Record<string, string>) =>
	itunesGet(host, "lookup", params, "iTunes lookup request failed");
const translationResult = Effect.fn("itunesTranslationResult")(function* (
	item: null | UnknownRecord,
	nameKey: string,
	missing: string,
) {
	if (!item) {
		return yield* new MediaSandboxError({ message: missing });
	}
	const name = stringValue(item[nameKey]);
	if (!name) {
		return yield* new MediaSandboxError({
			message: `iTunes ${nameKey === "collectionName" ? "podcast" : "podcast episode"} is missing title`,
		});
	}
	const description = yield* normalizeRichDescription(
		item["description"],
		"https://podcasts.apple.com",
	);
	return { name, ...(description ? { properties: { description } } : {}) };
});
export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const resultLimit = Math.min(input.page * input.pageSize, 200);
		return itunesGet(
			host,
			"search",
			{
				lang: "en_us",
				media: "podcast",
				term: input.query,
				entity: "podcast",
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
							title,
							externalId,
							...(image === null ? {} : { imageUrl: image }),
							...(publishYear === null ? {} : { metadata: [publishYear] as const }),
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
	},
});
type MappedEpisode = {
	id: string;
	title: string;
	number: number;
	publishDate: string;
	runtime: null | number;
	overview: null | string;
	thumbnail: null | string;
};
export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		const language = bcp47ToItunes("en");
		return lookup(host, {
			lang: language,
			media: "podcast",
			entity: "podcast",
			id: input.externalId,
		}).pipe(
			Effect.flatMap((detailsPayload) =>
				Effect.gen(function* () {
					const podcast = asRecord(resultsArray(detailsPayload)[0]);
					if (!podcast) {
						return yield* new MediaSandboxError({ message: "Podcast not found" });
					}
					const title = trimmedString(podcast["collectionName"]);
					if (!title) {
						return yield* new MediaSandboxError({ message: "Podcast is missing title" });
					}
					const totalEpisodes = positiveInt(podcast["trackCount"]);
					const genres = yield* collectGenres(podcast);
					const episodeLookup: Record<string, string> = {
						lang: language,
						media: "podcast",
						id: input.externalId,
						entity: "podcastEpisode",
					};
					if (totalEpisodes !== null) {
						episodeLookup["limit"] = String(totalEpisodes);
					}
					return yield* lookup(host, episodeLookup).pipe(
						Effect.flatMap((episodesPayload) =>
							Effect.gen(function* () {
								const unlinkedCreators: Array<{ role: string; name: string }> = [];
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
												number: 0,
												publishDate,
												title: episodeTitle,
												overview: stringValue(episode["description"]),
												runtime:
													typeof runtimeMillis === "number" && Number.isFinite(runtimeMillis)
														? Math.trunc(runtimeMillis / 1000 / 60)
														: null,
												thumbnail:
													stringValue(episode["artworkUrl600"]) ??
													stringValue(episode["artworkUrl100"]) ??
													stringValue(episode["artworkUrl60"]) ??
													stringValue(episode["artworkUrl30"]),
											},
										];
									})
									.sort((left, right) => {
										const publishDateDiff = left.publishDate.localeCompare(right.publishDate);
										return publishDateDiff !== 0
											? publishDateDiff
											: left.id.localeCompare(right.id);
									})
									.map((episode, index) => {
										episode.number = index + 1;
										return episode;
									});
								const childEntities = yield* Effect.forEach(episodes, (episode) =>
									Effect.gen(function* () {
										return {
											externalId: episode.id,
											entitySchemaSlug: "podcast-episode",
											name: episode.title || `Episode ${episode.number}`,
											properties: {
												runtime: episode.runtime,
												episodeNumber: episode.number,
												publishDate: episode.publishDate,
												parentPodcastExternalId: input.externalId,
												description: yield* normalizeRichDescription(
													episode.overview,
													"https://podcasts.apple.com",
												),
												...(episode.thumbnail
													? {
															images: [
																{ type: "remote", purpose: "cover", url: episode.thumbnail },
															],
														}
													: {}),
											},
										};
									}),
								);
								return {
									name: title,
									childEntities,
									expectedChildEntitySchemaSlug: "podcast-episode",
									properties: {
										unlinkedCreators,
										publishDate: getIsoDate(podcast["releaseDate"]),
										totalEpisodes: totalEpisodes ?? episodes.length,
										sourceUrl: buildSourceUrl(input.externalId, title),
										publishYear: getPublishYear(podcast["releaseDate"]),
										description: yield* normalizeRichDescription(
											podcast["description"],
											"https://podcasts.apple.com",
										),
										images: collectImages(podcast).map((url) => ({
											url,
											type: "remote" as const,
											purpose: "cover" as const,
										})),
									},
									...(genres === null
										? {}
										: { relatedEntityGroups: mediaGenreGroups("podcast", genres) }),
								};
							}),
						),
					);
				}),
			),
		);
	},
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
export const translate = defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) => {
		const providerLanguage = bcp47ToItunes(input.language);
		if (input.entitySchemaSlug === "podcast") {
			return lookup(host, {
				media: "podcast",
				entity: "podcast",
				id: input.externalId,
				lang: providerLanguage,
			}).pipe(
				Effect.flatMap((payload) =>
					translationResult(
						asRecord(resultsArray(payload)[0]),
						"collectionName",
						"iTunes podcast not found",
					),
				),
			);
		}
		if (input.entitySchemaSlug === "podcast-episode") {
			const parentPodcastExternalId = stringValue(
				asRecord(input.properties)?.["parentPodcastExternalId"],
			);
			if (!parentPodcastExternalId) {
				return Effect.fail(
					new MediaSandboxError({
						message: "parentPodcastExternalId is required for iTunes episode translation",
					}),
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
					translationResult(
						findPodcastEpisode(payload, input.externalId),
						"trackName",
						"iTunes podcast episode not found",
					),
				),
			);
		}
		return Effect.fail(
			new MediaSandboxError({
				message: "podcast.itunes translate supports only podcast and podcast-episode",
			}),
		);
	},
});
