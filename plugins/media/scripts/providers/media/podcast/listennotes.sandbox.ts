import { defineManifest, type SandboxHost } from "@ryot/sandbox-sdk/core";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { trimmedString } from "../../../script-helpers/records";

export const manifest = defineManifest({
	kind: "provider",
	name: "Listen Notes",
	slug: "podcast.listennotes",
	providerInformation: { source: "listennotes" },
	requiredAppConfigKeys: ["podcasts.listennotesApiKey"],
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
});
type ListennotesHost = SandboxHost<typeof manifest.capabilities>;
type UnknownRecord = Record<string, unknown>;
const GENRE_CACHE_KEY = "genres";
const GENRE_CACHE_TTL_SECONDS = 60 * 60 * 24;
const BASE_URL = "https://listen-api.listennotes.com/api/v2";
const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);
const stringValue = (value: unknown) => {
	const parsed = trimmedString(value);
	return parsed.length > 0 ? parsed : null;
};
const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;
const truncInt = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
const positiveInt = (value: unknown) => {
	const parsed = truncInt(value);
	return parsed !== null && parsed > 0 ? parsed : null;
};
const getPublishYearFromTimestamp = (value: unknown) => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	const parsed = dayjs(value);
	return parsed.isValid() ? Number(parsed.toISOString().slice(0, 4)) : null;
};
const getIsoDateFromTimestamp = (value: unknown) => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	const parsed = dayjs(value);
	return parsed.isValid() ? parsed.toISOString().slice(0, 10) : null;
};
const getSourceUrl = (title: string, externalId: string) =>
	`https://www.listennotes.com/podcasts/${trimmedString(title)}-${externalId}`;
const parseJsonResponse = (responseBody: string): unknown => {
	try {
		return JSON.parse(responseBody);
	} catch {
		throw new Error("ListenNotes returned invalid JSON");
	}
};
const getApiKey = (host: ListennotesHost) =>
	host.getAppConfigValue("podcasts.listennotesApiKey").pipe(
		Effect.flatMap((value) => {
			const apiKey = typeof value === "string" ? value.trim() : "";
			if (!apiKey) {
				return Effect.fail(new Error("PODCASTS_LISTENNOTES_API_KEY is not configured"));
			}
			return Effect.succeed(apiKey);
		}),
	);
const listennotesGet = (
	host: ListennotesHost,
	path: string,
	params?: Record<string, string | number | null | undefined>,
) =>
	getApiKey(host).pipe(
		Effect.flatMap((apiKey) => {
			const search = new URLSearchParams();
			for (const [key, value] of Object.entries(params ?? {})) {
				if (value === undefined || value === null) {
					continue;
				}
				search.set(key, String(value));
			}
			const suffix = search.size > 0 ? `?${search.toString()}` : "";
			return host
				.httpCall("GET", `${BASE_URL}${path}${suffix}`, { headers: { "X-ListenAPI-Key": apiKey } })
				.pipe(
					Effect.mapError((error) => new Error(error.message || "ListenNotes request failed")),
					Effect.flatMap((response) =>
						Effect.try({
							try: () => parseJsonResponse(response.body),
							catch: (error) => (error instanceof Error ? error : new Error(String(error))),
						}),
					),
				);
		}),
	);
const parseGenreMap = (value: unknown): Record<string, string> | null => {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(record)) {
		if (typeof entry !== "string") {
			return null;
		}
		result[key] = entry;
	}
	return result;
};
const getGenresById = (host: ListennotesHost) =>
	host.getCachedValue(GENRE_CACHE_KEY).pipe(
		Effect.flatMap((cached) => {
			const parsed = parseGenreMap(cached);
			if (parsed) {
				return Effect.succeed(parsed);
			}
			return listennotesGet(host, "/genres").pipe(
				Effect.flatMap((payload) => {
					const genres = asRecord(payload)?.["genres"];
					const byId: Record<string, string> = {};
					for (const raw of Array.isArray(genres) ? genres : []) {
						const genre = asRecord(raw);
						const id = truncInt(genre?.["id"]);
						const name = trimmedString(genre?.["name"]);
						if (id === null || !name) {
							continue;
						}
						byId[String(id)] = name;
					}
					return host
						.setCachedValue(GENRE_CACHE_KEY, byId, GENRE_CACHE_TTL_SECONDS)
						.pipe(Effect.as(byId));
				}),
			);
		}),
	);
const collectGenres = (genreIds: unknown, genresById: Record<string, string>) => {
	const values = new Set<string>();
	for (const raw of Array.isArray(genreIds) ? genreIds : []) {
		const id = truncInt(raw);
		if (id === null) {
			continue;
		}
		const genre = trimmedString(genresById[String(id)]);
		if (genre) {
			values.add(genre);
		}
	}
	return [...values];
};
const mapSearchItem = (raw: unknown) => {
	const item = asRecord(raw);
	const externalId = trimmedString(item?.["id"]);
	const title = trimmedString(item?.["title_original"] ?? item?.["title"]);
	if (!item || !externalId || !title) {
		return null;
	}
	const publishYear = getPublishYearFromTimestamp(item["earliest_pub_date_ms"]);
	const image = stringValue(item["image"]);
	return {
		externalId,
		titleProperty: { kind: "text" as const, value: title },
		calloutProperty: { kind: "null" as const, value: null },
		secondarySubtitleProperty: { kind: "null" as const, value: null },
		imageProperty: image
			? { kind: "image" as const, value: { type: "remote" as const, url: image } }
			: { kind: "null" as const, value: null },
		primarySubtitleProperty:
			publishYear === null
				? { kind: "null" as const, value: null }
				: { kind: "number" as const, value: publishYear },
	};
};
type MappedEpisode = {
	id: string;
	title: string;
	number: number;
	publishDate: string;
	runtime: number | null;
	overview: string | null;
	thumbnail: string | null;
};
const mapEpisode = (
	raw: unknown,
	episodeNumberOffset: number,
	index: number,
): MappedEpisode | null => {
	const item = asRecord(raw);
	const id = trimmedString(item?.["id"]);
	const title = trimmedString(item?.["title"]);
	const publishDate = getIsoDateFromTimestamp(item?.["pub_date_ms"]);
	if (!item || !id || !title || !publishDate) {
		return null;
	}
	const runtimeSeconds = positiveInt(item["audio_length_sec"]);
	return {
		id,
		title,
		publishDate,
		number: episodeNumberOffset + index + 1,
		overview: stringValue(item["description"]),
		thumbnail: stringValue(item["thumbnail"]),
		runtime: runtimeSeconds === null ? null : Math.trunc(runtimeSeconds / 60),
	};
};
const mapRecommendation = (raw: unknown) => {
	const item = asRecord(raw);
	const externalId = trimmedString(item?.["id"]);
	const title = trimmedString(item?.["title"] ?? item?.["title_original"]);
	if (!item || !externalId || !title) {
		return null;
	}
	return { name: title, externalId, scriptSlug: manifest.slug };
};
const fetchPodcastDetails = (
	host: ListennotesHost,
	externalId: string,
	nextEpisodePubDate: number | null,
) =>
	listennotesGet(host, `/podcasts/${encodeURIComponent(externalId)}`, {
		sort: "oldest_first",
		next_episode_pub_date: nextEpisodePubDate ?? "null",
	}).pipe(Effect.map((payload) => asRecord(payload)));
const fetchRecommendations = (host: ListennotesHost, externalId: string) =>
	listennotesGet(host, `/podcasts/${encodeURIComponent(externalId)}/recommendations`).pipe(
		Effect.map((payload) => {
			const items = asRecord(payload)?.["recommendations"];
			return (Array.isArray(items) ? items : []).flatMap((item) => {
				const mapped = mapRecommendation(item);
				return mapped ? [mapped] : [];
			});
		}),
	);
export const search = defineProviderDriver(manifest, "search", (input, host) =>
	listennotesGet(host, "/search", {
		q: input.query,
		type: "podcast",
		offset: (input.page - 1) * input.pageSize,
		len_per_page: input.pageSize,
	}).pipe(
		Effect.map((payloadValue) => {
			const payload = asRecord(payloadValue);
			const totalItems = positiveInt(payload?.["total"]) ?? 0;
			const results = payload?.["results"];
			const items = (Array.isArray(results) ? results : []).flatMap((raw) => {
				const item = mapSearchItem(raw);
				return item ? [item] : [];
			});
			const nextOffset = payload?.["next_offset"];
			return {
				items,
				details: {
					totalItems,
					nextPage: nextOffset === null || nextOffset === undefined ? null : input.page + 1,
				},
			};
		}),
	),
);
export const details = defineProviderDriver(manifest, "details", (input, host) =>
	Effect.gen(function* () {
		const genresById = yield* getGenresById(host);
		const firstPage = yield* fetchPodcastDetails(host, input.externalId, null);
		const title = trimmedString(firstPage?.["title"]);
		if (!title) {
			return yield* Effect.fail(new Error("Podcast is missing title"));
		}
		const totalEpisodes = positiveInt(firstPage?.["total_episodes"]);
		const episodes: MappedEpisode[] = [];
		const seenEpisodeIds = new Set<string>();
		const collectPage = (
			currentPodcast: UnknownRecord | null,
			episodeNumberOffset: number,
			previousEpisodePubDate: number | null,
		): Effect.Effect<UnknownRecord | null, unknown> => {
			const pageEpisodes: MappedEpisode[] = [];
			const rawEpisodesValue = currentPodcast?.["episodes"];
			const rawEpisodes = Array.isArray(rawEpisodesValue) ? rawEpisodesValue : [];
			for (const rawEpisode of rawEpisodes) {
				const episode = mapEpisode(rawEpisode, episodeNumberOffset, pageEpisodes.length);
				if (!episode || seenEpisodeIds.has(episode.id)) {
					continue;
				}
				seenEpisodeIds.add(episode.id);
				pageEpisodes.push(episode);
			}
			episodes.push(...pageEpisodes);
			const nextOffset = episodeNumberOffset + pageEpisodes.length;
			if (totalEpisodes === null || episodes.length >= totalEpisodes) {
				return Effect.succeed(firstPage);
			}
			if (pageEpisodes.length === 0) {
				return Effect.succeed(firstPage);
			}
			const nextEpisodePubDate = truncInt(currentPodcast?.["next_episode_pub_date"]);
			if (nextEpisodePubDate === null || nextEpisodePubDate === previousEpisodePubDate) {
				return Effect.succeed(firstPage);
			}
			return fetchPodcastDetails(host, input.externalId, nextEpisodePubDate).pipe(
				Effect.flatMap((nextPodcast) => collectPage(nextPodcast, nextOffset, nextEpisodePubDate)),
			);
		};
		yield* collectPage(firstPage, 0, null);
		const recommendations = yield* fetchRecommendations(host, input.externalId);
		const publisher = stringValue(firstPage?.["publisher"]);
		const image = stringValue(firstPage?.["image"]);
		const explicit = firstPage?.["explicit_content"];
		const childEntities = episodes.map((episode) => ({
			entitySchemaSlug: "podcast-episode",
			externalId: episode.id,
			name: episode.title || `Episode ${episode.number}`,
			properties: {
				runtime: episode.runtime,
				description: episode.overview,
				episodeNumber: episode.number,
				publishDate: episode.publishDate,
				...(episode.thumbnail ? { images: [{ type: "remote", url: episode.thumbnail }] } : {}),
			},
		}));
		return {
			name: title,
			childEntities,
			relatedEntityGroups: [
				{
					entities: recommendations,
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "media-suggestion",
				},
			],
			properties: {
				sourceUrl: getSourceUrl(title, input.externalId),
				totalEpisodes: totalEpisodes ?? episodes.length,
				description: stringValue(firstPage?.["description"]),
				genres: collectGenres(firstPage?.["genre_ids"], genresById),
				images: image ? [{ type: "remote" as const, url: image }] : [],
				providerRating: numberValue(firstPage?.["listen_score"]),
				publishDate: getIsoDateFromTimestamp(firstPage?.["earliest_pub_date_ms"]),
				unlinkedCreators: publisher ? [{ role: "Publishing", name: publisher }] : [],
				publishYear: getPublishYearFromTimestamp(firstPage?.["earliest_pub_date_ms"]),
				isNsfw: typeof explicit === "boolean" ? explicit : null,
			},
		};
	}),
);
export default defineProvider({ manifest, drivers: { search, details } });
