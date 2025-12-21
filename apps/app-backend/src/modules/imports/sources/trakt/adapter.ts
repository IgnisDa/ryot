import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";

import {
	addCollectionMembership,
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
} from "../../media/book/shared";
import { getOccurredAtValue, nowIso } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import type { ImportEntityRef, ImportMediaEntityGroup } from "../../media/types";
import { ImportSourceRequestError } from "../../runtime/source-api";

const TRAKT_API_VERSION = "2";
const TRAKT_PAGE_LIMIT = "1000";
const TRAKT_API_URL = "https://api.trakt.tv";

type TraktIds = {
	trakt: number;
	tmdb?: number;
	imdb?: string;
	slug?: string;
};

type TraktItem = {
	ids: TraktIds;
	year?: number;
	title?: string;
};

type TraktHistoryItem = {
	id: number;
	show?: TraktItem;
	movie?: TraktItem;
	watched_at: string;
	type: "movie" | "episode";
	episode?: { ids: TraktIds; season: number; number: number; title?: string };
};

type TraktRatingItem = {
	rating: number;
	rated_at: string;
	show?: TraktItem;
	movie?: TraktItem;
	type: "movie" | "show" | "season" | "episode";
};

type TraktWatchlistItem = {
	show?: TraktItem;
	movie?: TraktItem;
	listed_at?: string;
	type: "movie" | "show";
};

type TraktListItem = {
	show?: TraktItem;
	movie?: TraktItem;
	type: "movie" | "show";
};

type TraktList = {
	name: string;
	ids: TraktIds;
	description?: string;
};

type TraktCollectionItem = {
	show?: TraktItem;
	movie?: TraktItem;
};

const buildTraktClient = (clientId: string) => {
	const headers = {
		"trakt-api-key": clientId,
		"Content-Type": "application/json",
		"trakt-api-version": TRAKT_API_VERSION,
	};

	const buildUrl = (path: string, query?: Record<string, string>) => {
		const url = new URL(`${TRAKT_API_URL}${path}`);
		for (const [k, v] of Object.entries(query ?? {})) {
			url.searchParams.set(k, v);
		}
		return url;
	};

	const execute = (request: HttpClientRequest.HttpClientRequest, path: string) =>
		Effect.gen(function* () {
			const httpClient = yield* HttpClient.HttpClient;
			const response = yield* httpClient
				.execute(HttpClientRequest.setHeaders(headers)(request))
				.pipe(
					Effect.mapError(
						() =>
							new ImportSourceRequestError({
								context: {},
								message: `Trakt API request failed: ${path}`,
							}),
					),
				);
			return response;
		});

	const fetchJson = <T>(path: string, query?: Record<string, string>) =>
		Effect.gen(function* () {
			const url = buildUrl(path, query);
			const response = yield* execute(HttpClientRequest.get(url.toString()), path);
			if (response.status < 200 || response.status >= 300) {
				return yield* new ImportSourceRequestError({
					context: { status: response.status },
					message: `Trakt API error ${response.status}: ${path}`,
				});
			}
			// oxlint-disable-next-line no-unsafe-type-assertion
			return yield* response.json.pipe(Effect.map((value) => value as T));
		});

	const fetchPageCount = (path: string, query?: Record<string, string>) =>
		Effect.gen(function* () {
			const url = buildUrl(path, { ...query, limit: TRAKT_PAGE_LIMIT });
			const response = yield* execute(HttpClientRequest.head(url.toString()), path);
			if (response.status < 200 || response.status >= 300) {
				return yield* new ImportSourceRequestError({
					context: { status: response.status },
					message: `Trakt API error ${response.status}: fetching page count for ${path}`,
				});
			}
			const pageCountHeader = response.headers["x-pagination-page-count"];
			const totalPages = pageCountHeader ? Number.parseInt(pageCountHeader, 10) : 1;
			return Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1;
		});

	const fetchAll = <T>(path: string, query?: Record<string, string>) =>
		Effect.gen(function* () {
			const totalPages = yield* fetchPageCount(path, query);
			const all: T[] = [];
			for (let page = 1; page <= totalPages; page++) {
				const pageItems = yield* fetchJson<T[]>(path, {
					...query,
					limit: TRAKT_PAGE_LIMIT,
					page: String(page),
				});
				all.push(...pageItems);
			}
			return all;
		});

	return { fetchAll };
};

const extractTmdbId = (item: TraktItem): string | undefined =>
	item.ids.tmdb !== undefined ? String(item.ids.tmdb) : undefined;

const extractImdbId = (item: TraktItem): string | undefined => {
	const imdbId = item.ids.imdb?.trim();
	return imdbId?.length ? imdbId : undefined;
};

const missingProviderIdMessage = (entityType: "Movie" | "Show") =>
	`${entityType} does not have a TMDB or IMDb id`;

const buildMovieRef = (movie: TraktItem): ImportEntityRef | undefined => {
	const tmdbId = extractTmdbId(movie);
	if (tmdbId) {
		return {
			kind: "resolved",
			externalId: tmdbId,
			scriptSlug: "movie.tmdb",
			entitySchemaSlug: "movie",
			sourceLabel: movie.title ?? `Movie ${movie.ids.trakt}`,
		};
	}
	const imdbId = extractImdbId(movie);
	if (!imdbId) {
		return undefined;
	}
	return {
		kind: "unresolved",
		identifierType: "imdb",
		identifierValue: imdbId,
		entitySchemaSlug: "movie",
		sourceLabel: movie.title ?? `Movie ${movie.ids.trakt}`,
	};
};

const buildShowRef = (show: TraktItem): ImportEntityRef | undefined => {
	const tmdbId = extractTmdbId(show);
	if (tmdbId) {
		return {
			kind: "resolved",
			externalId: tmdbId,
			scriptSlug: "show.tmdb",
			entitySchemaSlug: "show",
			sourceLabel: show.title ?? `Show ${show.ids.trakt}`,
		};
	}
	const imdbId = extractImdbId(show);
	if (!imdbId) {
		return undefined;
	}
	return {
		kind: "unresolved",
		identifierType: "imdb",
		identifierValue: imdbId,
		entitySchemaSlug: "show",
		sourceLabel: show.title ?? `Show ${show.ids.trakt}`,
	};
};

export const adaptTraktData = (username: string, clientId: string) =>
	Effect.gen(function* () {
		const userUrl = `/users/${username}`;
		const client = buildTraktClient(clientId);

		const failures: MediaImportAdapterFailure[] = [];
		const groupMap = new Map<string, ImportMediaEntityGroup>();
		let itemIndex = 0;

		const history = yield* client.fetchAll<TraktHistoryItem>(`${userUrl}/history`);
		history.sort((a, b) => getOccurredAtValue(a.watched_at) - getOccurredAtValue(b.watched_at));
		for (const item of history) {
			itemIndex++;
			if (item.type === "movie" && item.movie) {
				const ref = buildMovieRef(item.movie);
				if (!ref) {
					failures.push({
						itemIndex,
						sourceLabel: item.movie.title,
						message: missingProviderIdMessage("Movie"),
						sourceIdentifier: String(item.movie.ids.trakt),
					});
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
				group.events.push(
					createCompleteEvent({ occurredAt: item.watched_at, completedOn: item.watched_at }),
				);
			} else if (item.type === "episode" && item.show && item.episode) {
				const ref = buildShowRef(item.show);
				if (!ref) {
					failures.push({
						itemIndex,
						sourceLabel: item.show.title,
						message: missingProviderIdMessage("Show"),
						sourceIdentifier: String(item.show.ids.trakt),
					});
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
				group.events.push({
					eventSchemaSlug: "progress",
					occurredAt: item.watched_at,
					properties: {
						progressPercent: 100,
						showSeason: item.episode.season,
						showEpisode: item.episode.number,
					},
				});
			}
		}

		for (const type of ["movies", "shows"] as const) {
			const ratings = yield* client.fetchAll<TraktRatingItem>(`${userUrl}/ratings/${type}`);
			for (const item of ratings) {
				itemIndex++;
				const sourceItem = type === "movies" ? item.movie : item.show;
				if (!sourceItem) {
					continue;
				}
				const ref = type === "movies" ? buildMovieRef(sourceItem) : buildShowRef(sourceItem);
				if (!ref) {
					failures.push({
						itemIndex,
						sourceLabel: sourceItem.title,
						sourceIdentifier: String(sourceItem.ids.trakt),
						message: missingProviderIdMessage(type === "movies" ? "Movie" : "Show"),
					});
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
				const reviewEvent = createReviewEvent({
					occurredAt: item.rated_at,
					rating: item.rating * 10,
				});
				if (reviewEvent) {
					group.events.push(reviewEvent);
				}
			}
		}

		const watchlist = yield* client.fetchAll<TraktWatchlistItem>(`${userUrl}/watchlist`);
		for (const item of watchlist) {
			itemIndex++;
			const sourceItem = item.type === "movie" ? item.movie : item.show;
			if (!sourceItem) {
				continue;
			}
			const ref = item.type === "movie" ? buildMovieRef(sourceItem) : buildShowRef(sourceItem);
			if (!ref) {
				failures.push({
					itemIndex,
					sourceLabel: sourceItem.title,
					sourceIdentifier: String(sourceItem.ids.trakt),
					message: missingProviderIdMessage(item.type === "movie" ? "Movie" : "Show"),
				});
				continue;
			}
			const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
			group.events.push(createBacklogEvent(item.listed_at ?? nowIso()));
		}

		const lists = yield* client.fetchAll<TraktList>(`${userUrl}/lists`);
		const lifecycleAliases = new Set(["watchlist"]);
		for (const list of lists) {
			const collectionName = list.name;
			if (lifecycleAliases.has(collectionName.toLowerCase())) {
				continue;
			}
			const items = yield* client.fetchAll<TraktListItem>(
				`${userUrl}/lists/${list.ids.trakt}/items`,
			);
			for (const item of items) {
				itemIndex++;
				const sourceItem = item.type === "movie" ? item.movie : item.show;
				if (!sourceItem) {
					continue;
				}
				const ref = item.type === "movie" ? buildMovieRef(sourceItem) : buildShowRef(sourceItem);
				if (!ref) {
					failures.push({
						itemIndex,
						sourceLabel: sourceItem.title,
						sourceIdentifier: String(sourceItem.ids.trakt),
						message: missingProviderIdMessage(item.type === "movie" ? "Movie" : "Show"),
					});
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
				addCollectionMembership(group, collectionName);
			}
		}

		for (const type of ["movies", "shows"] as const) {
			const items = yield* client.fetchAll<TraktCollectionItem>(`${userUrl}/collection/${type}`);
			for (const item of items) {
				itemIndex++;
				const sourceItem = type === "movies" ? item.movie : item.show;
				if (!sourceItem) {
					continue;
				}
				const ref = type === "movies" ? buildMovieRef(sourceItem) : buildShowRef(sourceItem);
				if (!ref) {
					failures.push({
						itemIndex,
						sourceLabel: sourceItem.title,
						sourceIdentifier: String(sourceItem.ids.trakt),
						message: missingProviderIdMessage(type === "movies" ? "Movie" : "Show"),
					});
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
				addCollectionMembership(group, "Owned");
			}
		}

		return {
			failures,
			entityGroups: finalizeEntityGroups(groupMap),
		} satisfies MediaImportAdapterResult;
	});
