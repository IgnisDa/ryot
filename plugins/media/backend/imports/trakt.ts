import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { MediaSandboxError } from "../lib/failures";
import type { ImportMediaEntityGroupBuilder } from "./groups";
import {
	addCollectionMembership,
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
} from "./helpers";
import type { ImportEntityRef, ImportMediaEvent, MediaIntegrationAdapterResult } from "./schemas";

const Ids = Schema.Struct({
	slug: Schema.optional(Schema.String),
	imdb: Schema.optional(Schema.NullOr(Schema.String)),
	tmdb: Schema.optional(Schema.NullOr(Schema.Finite)),
	trakt: Schema.optional(Schema.NullOr(Schema.Finite)),
});
const Item = Schema.Struct({
	ids: Ids,
	title: Schema.optional(Schema.String),
	year: Schema.optional(Schema.NullOr(Schema.Finite)),
});
type Item = typeof Item.Type;
const ExportComment = Schema.Struct({
	comment: Schema.String,
	spoiler: Schema.Boolean,
	created_at: Schema.String,
});
const ExportCoordinates = Schema.Struct({
	ids: Ids,
	number: Schema.optional(Schema.Finite),
	season: Schema.optional(Schema.Finite),
});
const ExportItem = Schema.Struct({
	show: Schema.optional(Item),
	movie: Schema.optional(Item),
	rating: Schema.optional(Schema.Finite),
	comment: Schema.optional(ExportComment),
	rated_at: Schema.optional(Schema.String),
	watched_at: Schema.optional(Schema.String),
	season: Schema.optional(ExportCoordinates),
	episode: Schema.optional(ExportCoordinates),
});
type ExportItem = typeof ExportItem.Type;

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

export type TraktRecordContext =
	| { type: "history" | "rating" | "comment" }
	| { type: "collection"; name: string }
	| { type: "backlog"; importedAt: string };

export const normalizeTraktRecord = (
	raw: unknown,
	context: TraktRecordContext,
): MediaIntegrationAdapterResult => {
	const item = Schema.decodeUnknownSync(ExportItem)(raw);
	const source = item.movie ?? item.show;
	const fail = (message: string): MediaIntegrationAdapterResult => ({
		entityGroups: [],
		failures: [
			{
				message,
				itemIndex: 0,
				sourceLabel: source?.title,
				sourceIdentifier:
					typeof source?.ids.trakt === "number" ? String(source.ids.trakt) : undefined,
			},
		],
	});
	const events: ImportMediaEvent[] = [];
	if (context.type === "history") {
		if (!item.watched_at) {
			return fail("History item does not have a watched date");
		}
		const unresolvedEpisode = item.show ? exportCoordinates(item) : undefined;
		if (item.show && !unresolvedEpisode) {
			return fail("Show history item has no episode coordinates");
		}
		events.push(
			unresolvedEpisode
				? {
						unresolvedEpisode,
						occurredAt: item.watched_at,
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
					}
				: createCompleteEvent({ occurredAt: item.watched_at }),
		);
	} else if (context.type === "rating" || context.type === "comment") {
		const comment = context.type === "comment" ? item.comment : undefined;
		const occurredAt = comment?.created_at ?? item.rated_at;
		const rating =
			context.type === "rating" && item.rating !== undefined ? item.rating * 10 : undefined;
		const review = occurredAt
			? createReviewEvent({
					occurredAt,
					...(comment ? { text: comment.comment, isSpoiler: comment.spoiler } : {}),
					...(rating === undefined ? {} : { rating }),
				})
			: null;
		if (!review) {
			return fail(`Trakt ${context.type} item does not contain review data`);
		}
		const unresolvedEpisode = exportReviewTarget(item);
		events.push(unresolvedEpisode ? { ...review, unresolvedEpisode } : review);
	}
	let entitySchemaSlug: "movie" | "show" | undefined;
	if (item.movie) {
		entitySchemaSlug = "movie";
	} else if (item.show) {
		entitySchemaSlug = "show";
	}
	if (!source || !entitySchemaSlug) {
		return fail("Item is neither a movie nor a show");
	}
	const entityRef = ref(source, entitySchemaSlug);
	if (!entityRef) {
		return fail(
			`${entitySchemaSlug === "movie" ? "Movie" : "Show"} does not have a TMDB or IMDb id`,
		);
	}
	const group: ImportMediaEntityGroupBuilder = {
		events,
		entityRef,
		itemIndex: 0,
		collectionMemberships: [],
	};
	if (context.type === "collection") {
		addCollectionMembership(group, context.name);
	} else if (context.type === "backlog") {
		const listing = Schema.decodeUnknownSync(
			Schema.Struct({ listed_at: Schema.optional(Schema.String) }),
		)(raw);
		group.events.push(createBacklogEvent(listing.listed_at ?? context.importedAt));
	}
	return { failures: [], entityGroups: [group] };
};

const invalidListUrl = () =>
	new MediaSandboxError({
		message:
			"Invalid Trakt list URL: expected an http(s) URL on trakt.tv or www.trakt.tv with path /users/{username}/lists/{slug}",
	});

export const parseListUrl = (value: string) => {
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

export const ref = (item: Item, entitySchemaSlug: "movie" | "show"): ImportEntityRef | null => {
	const sourceLabel =
		item.title ??
		`${entitySchemaSlug === "movie" ? "Movie" : "Show"} ${item.ids.trakt ?? "unknown"}`;
	if (typeof item.ids.tmdb === "number") {
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
				identifierValue: imdb,
				identifierType: "imdb",
			}
		: null;
};
