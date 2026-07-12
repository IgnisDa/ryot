import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import { getOccurredAtValue, nowIso } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	addCollectionMembership,
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
} from "./helpers";
import type { ImportEntityRef, MediaImportAdapterFailure } from "./schemas";
import { requestSourceJson, requestSourceResponse, type HttpHost } from "./source-api";

const API_URL = "https://api.trakt.tv";
const PAGE_LIMIT = "1000";
const Ids = Schema.Struct({
	tmdb: Schema.optional(Schema.Number),
	imdb: Schema.optional(Schema.String),
	slug: Schema.optional(Schema.String),
	trakt: Schema.optional(Schema.Number),
});
const Item = Schema.Struct({
	ids: Ids,
	year: Schema.optional(Schema.Number),
	title: Schema.optional(Schema.String),
});
type Item = typeof Item.Type;
const History = Schema.Struct({
	id: Schema.Number,
	watched_at: Schema.String,
	show: Schema.optional(Item),
	movie: Schema.optional(Item),
	type: Schema.Literals(["movie", "episode"]),
	episode: Schema.optional(
		Schema.Struct({
			ids: Ids,
			number: Schema.Number,
			season: Schema.Number,
			title: Schema.optional(Schema.String),
		}),
	),
});
const Rating = Schema.Struct({
	rating: Schema.Number,
	rated_at: Schema.String,
	show: Schema.optional(Item),
	movie: Schema.optional(Item),
	type: Schema.Literals(["movie", "show", "season", "episode"]),
});
const Watchlist = Schema.Struct({
	type: Schema.Literals(["movie", "show"]),
	show: Schema.optional(Item),
	movie: Schema.optional(Item),
	listed_at: Schema.optional(Schema.String),
});
const ListItem = Schema.Struct({
	type: Schema.Literals(["movie", "show"]),
	show: Schema.optional(Item),
	movie: Schema.optional(Item),
});
const List = Schema.Struct({
	ids: Ids,
	name: Schema.String,
	description: Schema.optional(Schema.String),
});
const CollectionItem = Schema.Struct({ show: Schema.optional(Item), movie: Schema.optional(Item) });

const ref = (item: Item, entitySchemaSlug: "movie" | "show"): ImportEntityRef | null => {
	const sourceLabel =
		item.title ??
		`${entitySchemaSlug === "movie" ? "Movie" : "Show"} ${item.ids.trakt ?? "unknown"}`;
	if (item.ids.tmdb !== undefined) {
		return {
			kind: "resolved",
			sourceLabel,
			entitySchemaSlug,
			externalId: String(item.ids.tmdb),
			providerSlug: `${entitySchemaSlug}.tmdb`,
		};
	}
	const imdb = item.ids.imdb?.trim();
	return imdb
		? {
				kind: "unresolved",
				sourceLabel,
				entitySchemaSlug,
				identifierType: "imdb",
				identifierValue: imdb,
			}
		: null;
};

export const adaptTraktData = (username: string, clientId: string, host: HttpHost) =>
	Effect.gen(function* () {
		const headers = {
			"trakt-api-key": clientId,
			"Content-Type": "application/json",
			"trakt-api-version": "2",
		};
		const fetchAll = <A, I, R>(
			path: string,
			schema: Schema.Schema<A> & Schema.Decoder<A, R> & Schema.Encoder<I>,
		) =>
			Effect.gen(function* () {
				const response = yield* requestSourceResponse(host, {
					path,
					headers,
					method: "HEAD",
					baseUrl: API_URL,
					query: { limit: PAGE_LIMIT },
				});
				const count = Number.parseInt(response.headers["x-pagination-page-count"] ?? "1", 10);
				const pages = Number.isFinite(count) && count > 0 ? count : 1;
				const values: A[] = [];
				for (let page = 1; page <= pages; page += 1) {
					const rows = yield* requestSourceJson(host, {
						path,
						headers,
						baseUrl: API_URL,
						query: { page, limit: PAGE_LIMIT },
					}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))));
					values.push(...rows);
				}
				return values;
			});
		const failures: MediaImportAdapterFailure[] = [];
		const groups = new Map<string, ImportMediaEntityGroupBuilder>();
		const userUrl = `/users/${username}`;
		let itemIndex = 0;
		const missing = (item: Item, kind: "Movie" | "Show") => {
			failures.push({
				itemIndex,
				sourceLabel: item.title,
				sourceIdentifier: item.ids.trakt === undefined ? undefined : String(item.ids.trakt),
				message: `${kind} does not have a TMDB or IMDb id`,
			});
		};
		const history = yield* fetchAll(`${userUrl}/history`, History);
		history.sort((a, b) => getOccurredAtValue(a.watched_at) - getOccurredAtValue(b.watched_at));
		for (const item of history) {
			itemIndex += 1;
			if (item.type === "movie" && item.movie) {
				const entityRef = ref(item.movie, "movie");
				if (!entityRef) {
					missing(item.movie, "Movie");
					continue;
				}
				getOrCreateMediaEntityGroup(groups, entityRef, itemIndex).events.push(
					createCompleteEvent({ occurredAt: item.watched_at, completedOn: item.watched_at }),
				);
			} else if (item.type === "episode" && item.show && item.episode) {
				const entityRef = ref(item.show, "show");
				if (!entityRef) {
					missing(item.show, "Show");
					continue;
				}
				getOrCreateMediaEntityGroup(groups, entityRef, itemIndex).events.push({
					occurredAt: item.watched_at,
					eventSchemaSlug: "progress",
					properties: { progressPercent: 100 },
					unresolvedEpisode: {
						type: "show",
						seasonNumber: item.episode.season,
						episodeNumber: item.episode.number,
					},
				});
			}
		}
		for (const type of ["movies", "shows"] as const) {
			for (const item of yield* fetchAll(`${userUrl}/ratings/${type}`, Rating)) {
				itemIndex += 1;
				const source = type === "movies" ? item.movie : item.show;
				if (!source) {
					continue;
				}
				const entityRef = ref(source, type === "movies" ? "movie" : "show");
				if (!entityRef) {
					missing(source, type === "movies" ? "Movie" : "Show");
					continue;
				}
				const review = createReviewEvent({ occurredAt: item.rated_at, rating: item.rating * 10 });
				if (review) {
					getOrCreateMediaEntityGroup(groups, entityRef, itemIndex).events.push(review);
				}
			}
		}
		for (const item of yield* fetchAll(`${userUrl}/watchlist`, Watchlist)) {
			itemIndex += 1;
			const source = item.type === "movie" ? item.movie : item.show;
			if (!source) {
				continue;
			}
			const entityRef = ref(source, item.type);
			if (!entityRef) {
				missing(source, item.type === "movie" ? "Movie" : "Show");
				continue;
			}
			getOrCreateMediaEntityGroup(groups, entityRef, itemIndex).events.push(
				createBacklogEvent(item.listed_at ?? nowIso()),
			);
		}
		for (const list of yield* fetchAll(`${userUrl}/lists`, List)) {
			if (list.name.toLowerCase() === "watchlist" || list.ids.trakt === undefined) {
				continue;
			}
			for (const item of yield* fetchAll(`${userUrl}/lists/${list.ids.trakt}/items`, ListItem)) {
				itemIndex += 1;
				const source = item.type === "movie" ? item.movie : item.show;
				if (!source) {
					continue;
				}
				const entityRef = ref(source, item.type);
				if (!entityRef) {
					missing(source, item.type === "movie" ? "Movie" : "Show");
					continue;
				}
				addCollectionMembership(
					getOrCreateMediaEntityGroup(groups, entityRef, itemIndex),
					list.name,
				);
			}
		}
		for (const type of ["movies", "shows"] as const) {
			for (const item of yield* fetchAll(`${userUrl}/collection/${type}`, CollectionItem)) {
				itemIndex += 1;
				const source = type === "movies" ? item.movie : item.show;
				if (!source) {
					continue;
				}
				const entityRef = ref(source, type === "movies" ? "movie" : "show");
				if (!entityRef) {
					missing(source, type === "movies" ? "Movie" : "Show");
					continue;
				}
				addCollectionMembership(getOrCreateMediaEntityGroup(groups, entityRef, itemIndex), "Owned");
			}
		}
		return {
			failures,
			totalItems: itemIndex === 0 ? 0 : itemIndex + 1,
			entityGroups: finalizeEntityGroups(groups.values()),
		};
	});
