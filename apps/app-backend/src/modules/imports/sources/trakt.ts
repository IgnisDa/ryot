import { dayjs } from "@ryot/ts-utils/dayjs";

import type {
	ImportEntityRef,
	ImportMediaEvent,
	ImportMediaEntityGroup,
	ImportCollectionMembership,
} from "../jobs";

const TRAKT_API_VERSION = "2";
const TRAKT_PAGE_LIMIT = "1000";
const TRAKT_API_URL = "https://api.trakt.tv";

export type TraktEntityRef = ImportEntityRef;
export type TraktNormalizedEvent = ImportMediaEvent;
export type TraktMediaEntityGroup = ImportMediaEntityGroup;
export type TraktCollectionMembership = ImportCollectionMembership;

export type TraktAdapterFailure = {
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
};

export type TraktAdapterResult = {
	failures: TraktAdapterFailure[];
	entityGroups: TraktMediaEntityGroup[];
};

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
	season?: { number: number };
	episode?: { season: number; number: number };
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
		if (query) {
			for (const [k, v] of Object.entries(query)) {
				url.searchParams.set(k, v);
			}
		}
		return url;
	};

	const fetchJson = async <T>(path: string, query?: Record<string, string>): Promise<T> => {
		const url = buildUrl(path, query);
		const response = await fetch(url.toString(), { headers });
		if (!response.ok) {
			throw new Error(`Trakt API error ${response.status}: ${path}`);
		}
		// oxlint-disable-next-line no-unsafe-type-assertion
		const json: unknown = await response.json();
		// oxlint-disable-next-line no-unsafe-type-assertion
		return json as T;
	};

	const fetchPageCount = async (path: string, query?: Record<string, string>): Promise<number> => {
		const url = buildUrl(path, { ...query, limit: TRAKT_PAGE_LIMIT });
		const headResponse = await fetch(url.toString(), { headers, method: "HEAD" });
		if (!headResponse.ok) {
			throw new Error(`Trakt API error ${headResponse.status}: fetching page count for ${path}`);
		}
		const pageCountHeader = headResponse.headers.get("x-pagination-page-count");
		const totalPages = pageCountHeader ? Number.parseInt(pageCountHeader, 10) : 1;
		return Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1;
	};

	const fetchAll = async <T>(path: string, query?: Record<string, string>): Promise<T[]> => {
		const totalPages = await fetchPageCount(path, query);
		const all: T[] = [];
		for (let page = 1; page <= totalPages; page++) {
			// oxlint-disable-next-line no-await-in-loop
			const pageItems = await fetchJson<T[]>(path, {
				...query,
				limit: TRAKT_PAGE_LIMIT,
				page: String(page),
			});
			all.push(...pageItems);
		}
		return all;
	};

	return { fetchAll };
};

const extractTmdbId = (item: TraktItem): string | undefined => {
	return item.ids.tmdb !== undefined ? String(item.ids.tmdb) : undefined;
};

const buildMovieRef = (movie: TraktItem): TraktEntityRef | undefined => {
	const tmdbId = extractTmdbId(movie);
	if (!tmdbId) {
		return undefined;
	}
	return {
		externalId: tmdbId,
		scriptSlug: "movie.tmdb",
		entitySchemaSlug: "movie",
		sourceLabel: movie.title ?? `Movie ${movie.ids.trakt}`,
	};
};

const buildShowRef = (show: TraktItem): TraktEntityRef | undefined => {
	const tmdbId = extractTmdbId(show);
	if (!tmdbId) {
		return undefined;
	}
	return {
		externalId: tmdbId,
		scriptSlug: "show.tmdb",
		entitySchemaSlug: "show",
		sourceLabel: show.title ?? `Show ${show.ids.trakt}`,
	};
};

const entityGroupKey = (ref: TraktEntityRef) =>
	`${ref.entitySchemaSlug}|${ref.scriptSlug}|${ref.externalId}`;

export const adaptTraktData = async (
	username: string,
	clientId: string,
): Promise<TraktAdapterResult> => {
	const userUrl = `/users/${username}`;
	const client = buildTraktClient(clientId);

	const failures: TraktAdapterFailure[] = [];
	const groupMap = new Map<string, TraktMediaEntityGroup>();
	let itemIndex = 0;

	const getOrCreate = (ref: TraktEntityRef): TraktMediaEntityGroup => {
		const key = entityGroupKey(ref);
		let group = groupMap.get(key);
		if (!group) {
			group = { entityRef: ref, events: [], collectionMemberships: [] };
			groupMap.set(key, group);
		}
		return group;
	};

	// History: movies become complete events, episodes become progress events
	const history = await client.fetchAll<TraktHistoryItem>(`${userUrl}/history`);
	history.sort((a, b) => dayjs(a.watched_at).valueOf() - dayjs(b.watched_at).valueOf());
	for (const item of history) {
		itemIndex++;
		if (item.type === "movie" && item.movie) {
			const ref = buildMovieRef(item.movie);
			if (!ref) {
				failures.push({
					itemIndex,
					sourceLabel: item.movie.title,
					message: "Movie does not have a TMDB id",
					sourceIdentifier: String(item.movie.ids.trakt),
				});
				continue;
			}
			const group = getOrCreate(ref);
			group.events.push({
				eventSchemaSlug: "complete",
				occurredAt: item.watched_at,
				properties: { completedOn: item.watched_at, completionMode: "custom_timestamps" },
			});
		} else if (item.type === "episode" && item.show && item.episode) {
			const ref = buildShowRef(item.show);
			if (!ref) {
				failures.push({
					itemIndex,
					sourceLabel: item.show.title,
					message: "Show does not have a TMDB id",
					sourceIdentifier: String(item.show.ids.trakt),
				});
				continue;
			}
			const group = getOrCreate(ref);
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

	// Ratings: movies and shows only (seasons/episodes have no entity in V2)
	for (const type of ["movies", "shows"] as const) {
		// oxlint-disable-next-line no-await-in-loop
		const ratings = await client.fetchAll<TraktRatingItem>(`${userUrl}/ratings/${type}`);
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
					message: `${type === "movies" ? "Movie" : "Show"} does not have a TMDB id`,
				});
				continue;
			}
			const group = getOrCreate(ref);
			// Trakt rates 1-10; V2 uses 0-100
			group.events.push({
				occurredAt: item.rated_at,
				eventSchemaSlug: "review",
				properties: { rating: item.rating * 10 },
			});
		}
	}

	// Watchlist → backlog events
	const watchlist = await client.fetchAll<TraktWatchlistItem>(`${userUrl}/watchlist`);
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
				message: `${item.type === "movie" ? "Movie" : "Show"} does not have a TMDB id`,
			});
			continue;
		}
		const group = getOrCreate(ref);
		group.events.push({
			properties: {},
			eventSchemaSlug: "backlog",
			occurredAt: item.listed_at ?? dayjs().toISOString(),
		});
	}

	// Custom lists → collection memberships
	const lists = await client.fetchAll<TraktList>(`${userUrl}/lists`);
	const lifecycleAliases = new Set(["watchlist", "favorites"]);
	for (const list of lists) {
		const collectionName = list.name;
		if (lifecycleAliases.has(collectionName.toLowerCase())) {
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop
		const items = await client.fetchAll<TraktListItem>(`${userUrl}/lists/${list.ids.trakt}/items`);
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
					message: `${item.type === "movie" ? "Movie" : "Show"} does not have a TMDB id`,
				});
				continue;
			}
			const group = getOrCreate(ref);
			const alreadyMember = group.collectionMemberships.some(
				(m) => m.collectionName === collectionName,
			);
			if (!alreadyMember) {
				group.collectionMemberships.push({ collectionName });
			}
		}
	}

	// Collection (owned items) → "Owned" collection membership
	for (const type of ["movies", "shows"] as const) {
		// oxlint-disable-next-line no-await-in-loop
		const items = await client.fetchAll<TraktCollectionItem>(`${userUrl}/collection/${type}`);
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
					message: `${type === "movies" ? "Movie" : "Show"} does not have a TMDB id`,
				});
				continue;
			}
			const group = getOrCreate(ref);
			const alreadyMember = group.collectionMemberships.some((m) => m.collectionName === "Owned");
			if (!alreadyMember) {
				group.collectionMemberships.push({ collectionName: "Owned" });
			}
		}
	}

	return { entityGroups: [...groupMap.values()], failures };
};
