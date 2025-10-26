import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect, Schema } from "effect";

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

const TraktIds = Schema.Struct({
	tmdb: Schema.optional(Schema.Number),
	imdb: Schema.optional(Schema.String),
	slug: Schema.optional(Schema.String),
	trakt: Schema.optional(Schema.Number),
});

const TraktItem = Schema.Struct({
	ids: TraktIds,
	year: Schema.optional(Schema.Number),
	title: Schema.optional(Schema.String),
});

const TraktEpisode = Schema.Struct({
	ids: TraktIds,
	number: Schema.Number,
	season: Schema.Number,
	title: Schema.optional(Schema.String),
});

const TraktHistoryItem = Schema.Struct({
	id: Schema.Number,
	watched_at: Schema.String,
	show: Schema.optional(TraktItem),
	movie: Schema.optional(TraktItem),
	type: Schema.Literal("movie", "episode"),
	episode: Schema.optional(TraktEpisode),
});

const TraktRatingItem = Schema.Struct({
	rating: Schema.Number,
	rated_at: Schema.String,
	show: Schema.optional(TraktItem),
	movie: Schema.optional(TraktItem),
	type: Schema.Literal("movie", "show", "season", "episode"),
});

const TraktWatchlistItem = Schema.Struct({
	type: Schema.Literal("movie", "show"),
	show: Schema.optional(TraktItem),
	movie: Schema.optional(TraktItem),
	listed_at: Schema.optional(Schema.String),
});

const TraktListItem = Schema.Struct({
	type: Schema.Literal("movie", "show"),
	show: Schema.optional(TraktItem),
	movie: Schema.optional(TraktItem),
});

const TraktList = Schema.Struct({
	ids: TraktIds,
	name: Schema.String,
	description: Schema.optional(Schema.String),
});

const TraktCollectionItem = Schema.Struct({
	show: Schema.optional(TraktItem),
	movie: Schema.optional(TraktItem),
});

type TraktItem = typeof TraktItem.Type;

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

	const fetchJson = <A, I, R>(
		path: string,
		schema: Schema.Schema<A, I, R>,
		query?: Record<string, string>,
	) =>
		Effect.gen(function* () {
			const url = buildUrl(path, query);
			const response = yield* execute(HttpClientRequest.get(url.toString()), path);
			if (response.status < 200 || response.status >= 300) {
				return yield* new ImportSourceRequestError({
					context: { status: response.status },
					message: `Trakt API error ${response.status}: ${path}`,
				});
			}
			return yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknown(schema)));
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

	const fetchAll = <A, I, R>(
		path: string,
		schema: Schema.Schema<A, I, R>,
		query?: Record<string, string>,
	) =>
		Effect.gen(function* () {
			const totalPages = yield* fetchPageCount(path, query);
			const all: A[] = [];
			for (let page = 1; page <= totalPages; page++) {
				const pageItems = yield* fetchJson(path, Schema.Array(schema), {
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
			sourceLabel: movie.title ?? `Movie ${movie.ids.trakt ?? "unknown"}`,
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
		sourceLabel: movie.title ?? `Movie ${movie.ids.trakt ?? "unknown"}`,
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
			sourceLabel: show.title ?? `Show ${show.ids.trakt ?? "unknown"}`,
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
		sourceLabel: show.title ?? `Show ${show.ids.trakt ?? "unknown"}`,
	};
};

export const adaptTraktData = Effect.fn("traktAdapter.adaptData")(function* (
	username: string,
	clientId: string,
) {
	const userUrl = `/users/${username}`;
	const client = buildTraktClient(clientId);

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();
	let itemIndex = 0;

	const history = yield* client.fetchAll(`${userUrl}/history`, TraktHistoryItem);
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
					sourceIdentifier:
						item.movie.ids.trakt !== undefined ? String(item.movie.ids.trakt) : undefined,
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
					sourceIdentifier:
						item.show.ids.trakt !== undefined ? String(item.show.ids.trakt) : undefined,
				});
				continue;
			}
			const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
			group.events.push({
				eventSchemaSlug: "progress",
				occurredAt: item.watched_at,
				properties: { progressPercent: 100 },
				episodeLocator: {
					type: "show",
					seasonNumber: item.episode.season,
					episodeNumber: item.episode.number,
				},
			});
		}
	}

	for (const type of ["movies", "shows"] as const) {
		const ratings = yield* client.fetchAll(`${userUrl}/ratings/${type}`, TraktRatingItem);
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
					message: missingProviderIdMessage(type === "movies" ? "Movie" : "Show"),
					sourceIdentifier:
						sourceItem.ids.trakt !== undefined ? String(sourceItem.ids.trakt) : undefined,
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

	const watchlist = yield* client.fetchAll(`${userUrl}/watchlist`, TraktWatchlistItem);
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
				message: missingProviderIdMessage(item.type === "movie" ? "Movie" : "Show"),
				sourceIdentifier:
					sourceItem.ids.trakt !== undefined ? String(sourceItem.ids.trakt) : undefined,
			});
			continue;
		}
		const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
		group.events.push(createBacklogEvent(item.listed_at ?? nowIso()));
	}

	const lists = yield* client.fetchAll(`${userUrl}/lists`, TraktList);
	const lifecycleAliases = new Set(["watchlist"]);
	for (const list of lists) {
		const collectionName = list.name;
		if (lifecycleAliases.has(collectionName.toLowerCase())) {
			continue;
		}
		if (list.ids.trakt === undefined) {
			continue;
		}
		const items = yield* client.fetchAll(`${userUrl}/lists/${list.ids.trakt}/items`, TraktListItem);
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
					message: missingProviderIdMessage(item.type === "movie" ? "Movie" : "Show"),
					sourceIdentifier:
						sourceItem.ids.trakt !== undefined ? String(sourceItem.ids.trakt) : undefined,
				});
				continue;
			}
			const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
			addCollectionMembership(group, collectionName);
		}
	}

	for (const type of ["movies", "shows"] as const) {
		const items = yield* client.fetchAll(`${userUrl}/collection/${type}`, TraktCollectionItem);
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
					message: missingProviderIdMessage(type === "movies" ? "Movie" : "Show"),
					sourceIdentifier:
						sourceItem.ids.trakt !== undefined ? String(sourceItem.ids.trakt) : undefined,
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
