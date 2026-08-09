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
import type { ImportEntityRef, MediaImportAdapterFailure, TraktImportTarget } from "./schemas";
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
	show: Schema.optional(Item),
	movie: Schema.optional(Item),
	listed_at: Schema.optional(Schema.String),
	type: Schema.Literals(["movie", "show"]),
});
const ListItem = Schema.Struct({
	type: Schema.String,
	show: Schema.optional(Item),
	movie: Schema.optional(Item),
});
type ListItem = typeof ListItem.Type;
const List = Schema.Struct({
	ids: Ids,
	name: Schema.String,
	description: Schema.optional(Schema.String),
});
const CollectionItem = Schema.Struct({ show: Schema.optional(Item), movie: Schema.optional(Item) });
const ExportComment = Schema.Struct({
	comment: Schema.String,
	spoiler: Schema.Boolean,
	created_at: Schema.String,
});
const ExportCoordinates = Schema.Struct({
	ids: Ids,
	number: Schema.optional(Schema.Number),
	season: Schema.optional(Schema.Number),
});
const ExportItem = Schema.Struct({
	show: Schema.optional(Item),
	movie: Schema.optional(Item),
	rating: Schema.optional(Schema.Number),
	comment: Schema.optional(ExportComment),
	rated_at: Schema.optional(Schema.String),
	watched_at: Schema.optional(Schema.String),
	season: Schema.optional(ExportCoordinates),
	episode: Schema.optional(ExportCoordinates),
});
type ExportItem = typeof ExportItem.Type;
const ExportList = Schema.Struct({
	ids: Ids,
	name: Schema.String,
	description: Schema.optional(Schema.String),
});

const numberedPage = (name: string, stem: string) => {
	if (!name.startsWith(stem) || !name.endsWith(".json")) {
		return undefined;
	}
	const suffix = name.slice(stem.length, -".json".length);
	if (!suffix) {
		return 0;
	}
	if (!suffix.startsWith("-")) {
		return undefined;
	}
	const page = Number.parseInt(suffix.slice(1), 10);
	return Number.isSafeInteger(page) && page >= 0 && String(page) === suffix.slice(1)
		? page
		: undefined;
};

export const classifyTraktExportName = (path: string) => {
	const name = path.split(/[\\/]/).pop() ?? "";
	const listMetadataPage = numberedPage(name, "lists-lists");
	if (listMetadataPage !== undefined) {
		return { name, page: listMetadataPage, kind: { order: 0, type: "list-metadata" } } as const;
	}
	for (const mediaType of ["movies", "shows", "seasons", "episodes"] as const) {
		for (const [prefix, kind] of [
			["ratings", { order: 2, type: "rating" }],
			["comments", { order: 3, type: "comment" }],
		] as const) {
			const page = numberedPage(name, `${prefix}-${mediaType}`);
			if (page !== undefined) {
				return { name, page, kind };
			}
		}
	}
	for (const mediaType of ["movies", "shows"] as const) {
		const page = numberedPage(name, `collection-${mediaType}`);
		if (page !== undefined) {
			return { name, page, kind: { order: 4, type: "collection" } } as const;
		}
	}
	const historyPage = numberedPage(name, "watched-history");
	if (historyPage !== undefined) {
		return { name, page: historyPage, kind: { order: 1, type: "history" } } as const;
	}
	for (const list of ["watchlist", "favorites"] as const) {
		const page = numberedPage(name, `lists-${list}`);
		if (page !== undefined) {
			return { name, page, kind: { order: 5, type: "system-list" } } as const;
		}
	}
	const custom = name.match(/^lists-list-(\d+)-.+\.json$/);
	const id = custom?.[1] ? Number.parseInt(custom[1], 10) : Number.NaN;
	return Number.isSafeInteger(id)
		? ({ name, page: 0, kind: { id, order: 6, type: "custom-list" } } as const)
		: undefined;
};

const decodeExportEntry = <A>(
	name: string,
	bytes: Uint8Array,
	schema: Schema.Schema<A> & Schema.Decoder<A>,
) => {
	try {
		return Schema.decodeUnknownSync(schema)(JSON.parse(new TextDecoder().decode(bytes)));
	} catch (error) {
		throw new Error(`Invalid JSON in Trakt export entry ${name}`, { cause: error });
	}
};

const exportCoordinates = (item: ExportItem) =>
	item.episode?.season !== undefined && item.episode.number !== undefined
		? {
				type: "show" as const,
				seasonNumber: item.episode.season,
				episodeNumber: item.episode.number,
			}
		: undefined;

const exportReviewTarget = (item: ExportItem) =>
	exportCoordinates(item) ??
	(item.season?.number === undefined
		? undefined
		: { type: "show-season" as const, seasonNumber: item.season.number });

export const adaptTraktExport = (archive: Record<string, Uint8Array>) => {
	const entries = Object.entries(archive)
		.flatMap(([path, bytes]) => {
			const classified = classifyTraktExportName(path);
			return classified ? [{ ...classified, bytes }] : [];
		})
		.sort(
			(left, right) =>
				left.kind.order - right.kind.order ||
				(left.kind.type === "custom-list" && right.kind.type === "custom-list"
					? left.kind.id - right.kind.id
					: 0) ||
				left.page - right.page ||
				left.name.localeCompare(right.name),
		);
	if (entries.length === 0) {
		throw new Error("Trakt export ZIP does not contain any recognized files");
	}

	const lists = new Map<number, string>();
	for (const entry of entries) {
		if (entry.kind.type !== "list-metadata") {
			continue;
		}
		for (const list of decodeExportEntry(entry.name, entry.bytes, Schema.Array(ExportList))) {
			if (list.ids.trakt !== undefined) {
				lists.set(list.ids.trakt, list.name);
			}
		}
	}

	const failures: MediaImportAdapterFailure[] = [];
	const groups = new Map<string, ImportMediaEntityGroupBuilder>();
	let itemIndex = 0;
	const fail = (item: ExportItem, currentIndex: number, message: string) => {
		const source = item.movie ?? item.show;
		failures.push({
			message,
			itemIndex: currentIndex,
			sourceLabel: source?.title,
			sourceIdentifier: source?.ids.trakt === undefined ? undefined : String(source.ids.trakt),
		});
	};
	const groupFor = (item: ExportItem, currentIndex: number) => {
		let entitySchemaSlug: "movie" | "show" | undefined;
		if (item.movie) {
			entitySchemaSlug = "movie";
		} else if (item.show) {
			entitySchemaSlug = "show";
		}
		const source = item.movie ?? item.show;
		if (!source || !entitySchemaSlug) {
			fail(item, currentIndex, "Item is neither a movie nor a show");
			return undefined;
		}
		const entityRef = ref(source, entitySchemaSlug);
		if (!entityRef) {
			fail(
				item,
				currentIndex,
				`${entitySchemaSlug === "movie" ? "Movie" : "Show"} does not have a TMDB or IMDb id`,
			);
			return undefined;
		}
		return getOrCreateMediaEntityGroup(groups, entityRef, currentIndex);
	};

	for (const entry of entries) {
		if (entry.kind.type === "list-metadata") {
			continue;
		}
		const items = decodeExportEntry(entry.name, entry.bytes, Schema.Array(ExportItem));
		for (const item of items) {
			const currentIndex = itemIndex++;
			if (entry.kind.type === "history") {
				if (!item.watched_at) {
					fail(item, currentIndex, "History item does not have a watched date");
					continue;
				}
				const unresolvedEpisode = item.show ? exportCoordinates(item) : undefined;
				if (item.show && !unresolvedEpisode) {
					fail(item, currentIndex, "Show history item has no episode coordinates");
					continue;
				}
				const group = groupFor(item, currentIndex);
				if (!group) {
					continue;
				}
				if (unresolvedEpisode) {
					group.events.push({
						unresolvedEpisode,
						occurredAt: item.watched_at,
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
					});
				} else {
					group.events.push(
						createCompleteEvent({ occurredAt: item.watched_at, completedOn: item.watched_at }),
					);
				}
				continue;
			}
			if (entry.kind.type === "rating" || entry.kind.type === "comment") {
				const comment = entry.kind.type === "comment" ? item.comment : undefined;
				const occurredAt = comment?.created_at ?? item.rated_at;
				const rating =
					entry.kind.type === "rating" && item.rating !== undefined ? item.rating * 10 : undefined;
				const review = occurredAt
					? createReviewEvent({
							occurredAt,
							...(comment ? { text: comment.comment, isSpoiler: comment.spoiler } : {}),
							...(rating === undefined ? {} : { rating }),
						})
					: null;
				if (!review) {
					fail(item, currentIndex, `Trakt ${entry.kind.type} item does not contain review data`);
					continue;
				}
				const group = groupFor(item, currentIndex);
				if (!group) {
					continue;
				}
				const unresolvedEpisode = exportReviewTarget(item);
				group.events.push(unresolvedEpisode ? { ...review, unresolvedEpisode } : review);
				continue;
			}
			const group = groupFor(item, currentIndex);
			if (!group) {
				continue;
			}
			let collectionName: string;
			if (entry.kind.type === "collection") {
				collectionName = "Owned";
			} else if (entry.kind.type === "system-list") {
				collectionName = entry.name.includes("watchlist") ? "Watchlist" : "Favorites";
			} else {
				collectionName = lists.get(entry.kind.id) ?? `Trakt List ${entry.kind.id}`;
			}
			addCollectionMembership(group, collectionName);
		}
	}
	return { failures, totalItems: itemIndex, entityGroups: finalizeEntityGroups(groups.values()) };
};

const invalidListUrl = () =>
	new Error(
		"Invalid Trakt list URL: expected an http(s) URL on trakt.tv or www.trakt.tv with path /users/{username}/lists/{slug}",
	);

const parseListUrl = (value: string) => {
	const url = new URL(value);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		!["trakt.tv", "www.trakt.tv"].includes(url.hostname) ||
		url.port
	) {
		throw invalidListUrl();
	}
	const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
	const segments = pathname.split("/");
	if (
		segments.length !== 5 ||
		segments[0] !== "" ||
		segments[1] !== "users" ||
		segments[2] === "" ||
		segments[3] !== "lists" ||
		segments[4] === ""
	) {
		throw invalidListUrl();
	}
	const rawUsername = segments[2];
	const rawSlug = segments[4];
	if (!rawUsername || !rawSlug) {
		throw invalidListUrl();
	}
	const username = decodeURIComponent(rawUsername);
	const slug = decodeURIComponent(rawSlug);
	if (!username || !slug) {
		throw invalidListUrl();
	}
	return `/users/${encodeURIComponent(username)}/lists/${encodeURIComponent(slug)}/items`;
};

const ref = (item: Item, entitySchemaSlug: "movie" | "show"): ImportEntityRef | null => {
	const sourceLabel =
		item.title ??
		`${entitySchemaSlug === "movie" ? "Movie" : "Show"} ${item.ids.trakt ?? "unknown"}`;
	if (item.ids.tmdb !== undefined) {
		return {
			sourceLabel,
			kind: "resolved",
			entitySchemaSlug,
			externalId: String(item.ids.tmdb),
			providerSlug: `${entitySchemaSlug}.tmdb`,
		};
	}
	const imdb = item.ids.imdb?.trim();
	return imdb
		? {
				sourceLabel,
				entitySchemaSlug,
				kind: "unresolved",
				identifierType: "imdb",
				identifierValue: imdb,
			}
		: null;
};

type TraktApiTarget = Exclude<TraktImportTarget, { mode: "export" }>;

export const adaptTraktData = (target: TraktApiTarget, clientId: string, host: HttpHost) =>
	Effect.gen(function* () {
		const headers = {
			"trakt-api-version": "2",
			"trakt-api-key": clientId,
			"Content-Type": "application/json",
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
		let itemIndex = 0;
		const nextItemIndex = () => itemIndex++;
		const missing = (item: Item, kind: "Movie" | "Show", currentIndex: number) => {
			failures.push({
				itemIndex: currentIndex,
				sourceLabel: item.title,
				message: `${kind} does not have a TMDB or IMDb id`,
				sourceIdentifier: item.ids.trakt === undefined ? undefined : String(item.ids.trakt),
			});
		};
		const importListItems = (items: ListItem[], collection: string) => {
			for (const item of items) {
				const currentIndex = nextItemIndex();
				if (item.type !== "movie" && item.type !== "show") {
					continue;
				}
				const source = item.type === "movie" ? item.movie : item.show;
				if (!source) {
					continue;
				}
				const entityRef = ref(source, item.type);
				if (!entityRef) {
					missing(source, item.type === "movie" ? "Movie" : "Show", currentIndex);
					continue;
				}
				addCollectionMembership(
					getOrCreateMediaEntityGroup(groups, entityRef, currentIndex),
					collection,
				);
			}
		};
		if (target.mode === "list") {
			const listPath = yield* Effect.try({
				try: () => parseListUrl(target.url),
				catch: () => invalidListUrl(),
			});
			const items = yield* fetchAll(listPath, ListItem);
			importListItems(items, target.collection);
			return {
				failures,
				totalItems: itemIndex,
				entityGroups: finalizeEntityGroups(groups.values()),
			};
		}
		const userUrl = `/users/${target.username}`;
		const history = yield* fetchAll(`${userUrl}/history`, History);
		history.sort((a, b) => getOccurredAtValue(a.watched_at) - getOccurredAtValue(b.watched_at));
		for (const item of history) {
			const currentIndex = nextItemIndex();
			if (item.type === "movie" && item.movie) {
				const entityRef = ref(item.movie, "movie");
				if (!entityRef) {
					missing(item.movie, "Movie", currentIndex);
					continue;
				}
				getOrCreateMediaEntityGroup(groups, entityRef, currentIndex).events.push(
					createCompleteEvent({ occurredAt: item.watched_at, completedOn: item.watched_at }),
				);
			} else if (item.type === "episode" && item.show && item.episode) {
				const entityRef = ref(item.show, "show");
				if (!entityRef) {
					missing(item.show, "Show", currentIndex);
					continue;
				}
				getOrCreateMediaEntityGroup(groups, entityRef, currentIndex).events.push({
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
				const currentIndex = nextItemIndex();
				const source = type === "movies" ? item.movie : item.show;
				if (!source) {
					continue;
				}
				const entityRef = ref(source, type === "movies" ? "movie" : "show");
				if (!entityRef) {
					missing(source, type === "movies" ? "Movie" : "Show", currentIndex);
					continue;
				}
				const review = createReviewEvent({ occurredAt: item.rated_at, rating: item.rating * 10 });
				if (review) {
					getOrCreateMediaEntityGroup(groups, entityRef, currentIndex).events.push(review);
				}
			}
		}
		for (const item of yield* fetchAll(`${userUrl}/watchlist`, Watchlist)) {
			const currentIndex = nextItemIndex();
			const source = item.type === "movie" ? item.movie : item.show;
			if (!source) {
				continue;
			}
			const entityRef = ref(source, item.type);
			if (!entityRef) {
				missing(source, item.type === "movie" ? "Movie" : "Show", currentIndex);
				continue;
			}
			getOrCreateMediaEntityGroup(groups, entityRef, currentIndex).events.push(
				createBacklogEvent(item.listed_at ?? nowIso()),
			);
		}
		for (const list of yield* fetchAll(`${userUrl}/lists`, List)) {
			if (list.name.toLowerCase() === "watchlist" || list.ids.trakt === undefined) {
				continue;
			}
			importListItems(
				yield* fetchAll(`${userUrl}/lists/${list.ids.trakt}/items`, ListItem),
				list.name,
			);
		}
		for (const type of ["movies", "shows"] as const) {
			for (const item of yield* fetchAll(`${userUrl}/collection/${type}`, CollectionItem)) {
				const currentIndex = nextItemIndex();
				const source = type === "movies" ? item.movie : item.show;
				if (!source) {
					continue;
				}
				const entityRef = ref(source, type === "movies" ? "movie" : "show");
				if (!entityRef) {
					missing(source, type === "movies" ? "Movie" : "Show", currentIndex);
					continue;
				}
				addCollectionMembership(
					getOrCreateMediaEntityGroup(groups, entityRef, currentIndex),
					"Owned",
				);
			}
		}
		return {
			failures,
			totalItems: itemIndex,
			entityGroups: finalizeEntityGroups(groups.values()),
		};
	});
