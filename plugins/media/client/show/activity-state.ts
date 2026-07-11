import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { ShowActivityEvent, ShowActivityResult } from "../../shared/show-recipes";
import type { MediaActivityState } from "../media/activity-tab";
import {
	activitySpan,
	anchorOf,
	decimalLabel,
	mediaActivityTimeline,
	mediaBeatRow,
	mediaCollectionRow,
	mediaCompletionRow,
	mediaReviewRow,
	nonEmpty,
	optionalText,
	type MediaActivityBeatRow,
	type MediaActivityCollectionRow,
	type MediaActivityCompletedWatch,
	type MediaActivityCompletionRow,
	type MediaActivityReviewRow,
	type MediaActivitySpan,
	type MediaActivityTimeline,
	type NonEmpty,
} from "../media/activity-timeline";
import { formatLocalDateKey } from "../media/date";
import { classifyRyotQueryResult } from "../media/query-state";
import {
	isSpecialsSeason,
	seasonOrder,
	showEpisodeOriginLabel,
	showSeasonOriginLabel,
} from "./episodes-state";

type ParentEvent = Extract<ShowActivityEvent, { kind: "parent" }>;
type EpisodeEvent = Extract<ShowActivityEvent, { kind: "episode" }>;
type CollectionEvent = Extract<ShowActivityEvent, { kind: "collection" }>;

type ActivityBeat = Exclude<ParentEvent["eventSchemaSlug"], "review" | "complete">;

type ShowActivityWatchedEpisode = {
	readonly id: string;
	readonly name: string;
	readonly origin: string;
	readonly seasonNumber: number;
	readonly episodeNumber: number;
	readonly minutes: number | undefined;
};

type ShowActivityReviewSubject =
	| { readonly on: "show" }
	| { readonly on: "episode"; readonly name: string; readonly origin: string };

export type ShowActivityWatchRow = {
	readonly key: string;
	readonly dateKey: string;
	readonly type: "watch";
	readonly occurredAt: string;
	readonly source: string | undefined;
	readonly episodes: readonly [ShowActivityWatchedEpisode, ...ShowActivityWatchedEpisode[]];
};

type ShowActivityProgressRow = {
	readonly key: string;
	readonly dateKey: string;
	readonly type: "progress";
	readonly occurredAt: string;
	readonly source: string | undefined;
	readonly percent: number | undefined;
	readonly episode: ShowActivityWatchedEpisode;
};

export type ShowActivityReviewRow = MediaActivityReviewRow<ShowActivityReviewSubject>;

export type ShowActivityCollectionRow = MediaActivityCollectionRow;

export type ShowActivityRow =
	| ShowActivityWatchRow
	| ShowActivityReviewRow
	| ShowActivityProgressRow
	| ShowActivityCollectionRow
	| MediaActivityCompletionRow
	| MediaActivityBeatRow<ActivityBeat>;

export type ShowActivityCompletedWatch = MediaActivityCompletedWatch<ShowActivityRow>;

export type ShowActivityTimeline = MediaActivityTimeline<ShowActivityRow>;

export type ShowActivitySeasonCoverage = {
	readonly label: string;
	readonly watched: number;
	readonly seasonNumber: number;
	readonly total: number | undefined;
	readonly percent: number | undefined;
};

export type ShowActivityCoverage = {
	readonly seasons: readonly ShowActivitySeasonCoverage[];
	readonly specials: ShowActivitySeasonCoverage | undefined;
	readonly headline: { readonly watched: number; readonly total: number | undefined };
};

export type ShowActivitySummary = {
	readonly watches: number;
	readonly span: MediaActivitySpan;
	readonly minutes: { readonly total: number; readonly missing: number };
	readonly episodes: { readonly watched: number; readonly total: number | undefined };
};

export type ShowActivityView = {
	readonly summary: ShowActivitySummary;
	readonly coverage: ShowActivityCoverage;
	readonly timeline: ShowActivityTimeline;
};

export type ShowActivityState = MediaActivityState<ShowActivityView>;

const watchedEpisode = (event: EpisodeEvent): ShowActivityWatchedEpisode => ({
	id: event.episode.id,
	name: event.episode.name,
	seasonNumber: event.episode.seasonNumber,
	episodeNumber: event.episode.episodeNumber,
	origin: showEpisodeOriginLabel(event.episode),
	minutes: event.timeSpent ?? event.episode.runtime ?? undefined,
});

const parentEventRow = (event: ParentEvent): ShowActivityRow => {
	if (event.eventSchemaSlug === "complete") {
		return mediaCompletionRow(event);
	}
	if (event.eventSchemaSlug === "review") {
		return mediaReviewRow(event, { on: "show" });
	}
	return mediaBeatRow(event, event.eventSchemaSlug);
};

const episodeEventRow = (event: EpisodeEvent): ShowActivityRow => {
	if (event.eventSchemaSlug === "review") {
		return mediaReviewRow(event, {
			on: "episode",
			name: event.episode.name,
			origin: showEpisodeOriginLabel(event.episode),
		});
	}
	return {
		...anchorOf(event, "progress"),
		type: "progress",
		episode: watchedEpisode(event),
		source: optionalText(event.consumedOn),
		percent: event.progressPercent ?? undefined,
	};
};

const collectionEventRow = (event: CollectionEvent): ShowActivityRow => mediaCollectionRow(event);

const activityRow = (event: ShowActivityEvent): ShowActivityRow => {
	if (event.kind === "parent") {
		return parentEventRow(event);
	}
	if (event.kind === "episode") {
		return episodeEventRow(event);
	}
	return collectionEventRow(event);
};

type ShowActivityWatchDay = ShowActivityResult["watchDays"][number];

const watchDayRows = (watchDays: readonly ShowActivityWatchDay[]) => {
	const days = new Map<string, Map<string, ShowActivityWatchedEpisode>>();
	const sources = new Map<string, string>();
	for (const watch of watchDays) {
		const episodes = days.get(watch.day) ?? new Map<string, ShowActivityWatchedEpisode>();
		if (!episodes.has(watch.episodeId)) {
			episodes.set(watch.episodeId, {
				id: watch.episodeId,
				name: watch.episodeName,
				seasonNumber: watch.seasonNumber,
				episodeNumber: watch.episodeNumber,
				origin: showEpisodeOriginLabel(watch),
				minutes: watch.minutes ?? watch.runtime ?? undefined,
			});
		}
		days.set(watch.day, episodes);
		const source = optionalText(watch.consumedOn);
		if (source !== undefined && !sources.has(watch.day)) {
			sources.set(watch.day, source);
		}
	}
	return [...days.entries()].flatMap(([day, episodes]): readonly ShowActivityWatchRow[] => {
		const listed = nonEmpty([...episodes.values()]);
		return listed === undefined
			? []
			: [
					{
						type: "watch",
						occurredAt: day,
						episodes: listed,
						key: `watch-${day}`,
						source: sources.get(day),
						dateKey: formatLocalDateKey(day),
					},
				];
	});
};

const showActivityPredicates = {
	isCompletion: (row: ShowActivityRow) => row.type === "completion",
	isWatching: (row: ShowActivityRow) => row.type === "watch" || row.type === "progress",
};

type ShowActivitySeasonRow = ShowActivityResult["seasons"][number];

const seasonCoverage = (season: ShowActivitySeasonRow): ShowActivitySeasonCoverage => ({
	total: season.episodeTotal,
	watched: season.watchedTotal,
	seasonNumber: season.seasonNumber,
	label: showSeasonOriginLabel(season),
	percent:
		season.episodeTotal === 0
			? undefined
			: Math.min(Math.round((season.watchedTotal / season.episodeTotal) * 100), 100),
});

export const showActivityCoverage = (result: ShowActivityResult): ShowActivityCoverage => {
	const rows = [...result.seasons].sort((left, right) => seasonOrder(left) - seasonOrder(right));
	const seasons = rows.filter((row) => !isSpecialsSeason(row));
	return {
		seasons: seasons.map(seasonCoverage),
		specials: rows.filter(isSpecialsSeason).map(seasonCoverage).at(0),
		headline: {
			watched: seasons.reduce((total, season) => total + season.watchedTotal, 0),
			total:
				seasons.length === 0
					? undefined
					: seasons.reduce((total, season) => total + season.episodeTotal, 0),
		},
	};
};

const watchedMinutes = (seasons: readonly ShowActivitySeasonRow[]) =>
	seasons.reduce(
		(totals, season) => ({
			total: totals.total + (season.watchedMinutes ?? 0),
			missing: totals.missing + season.watchedUnknownRuntime,
		}),
		{ total: 0, missing: 0 },
	);

const showActivitySummary = (input: {
	readonly result: ShowActivityResult;
	readonly coverage: ShowActivityCoverage;
	readonly rows: NonEmpty<ShowActivityRow>;
}): ShowActivitySummary => ({
	watches: input.result.watchCount,
	minutes: watchedMinutes(input.result.seasons),
	span: activitySpan(input.rows, input.result.truncated),
	episodes: { total: input.coverage.headline.total, watched: input.coverage.headline.watched },
});

export const showActivityView = (result: ShowActivityResult): ShowActivityView | undefined => {
	const rows = [...watchDayRows(result.watchDays), ...result.events.map(activityRow)].sort(
		(left, right) =>
			right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key),
	);
	const spanned = nonEmpty(rows);
	const timeline = mediaActivityTimeline(rows, showActivityPredicates);
	if (timeline === undefined || spanned === undefined) {
		return undefined;
	}
	const coverage = showActivityCoverage(result);
	return { coverage, timeline, summary: showActivitySummary({ result, coverage, rows: spanned }) };
};

export const mapShowActivity = (result: RyotQueryResult<ShowActivityResult>): ShowActivityState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const view = showActivityView(state.value);
	return view === undefined ? { status: "empty" } : { view, status: "ready" };
};

const BEAT_LABELS: Record<ActivityBeat, string> = {
	backlog: "Added to backlog",
	dropped: "Stopped watching",
	on_hold: "Put this show on hold",
};

export const showActivityRowLabel = (row: ShowActivityRow): string => {
	if (row.type === "completion") {
		return "Finished the show";
	}
	if (row.type === "collection") {
		return row.change === "added"
			? `Added to the ${row.name} collection`
			: `Removed from the ${row.name} collection`;
	}
	if (row.type === "beat") {
		return BEAT_LABELS[row.beat];
	}
	if (row.type === "progress") {
		return row.percent === undefined
			? `Part-way through ${row.episode.origin} · ${row.episode.name}`
			: `${decimalLabel(row.percent)}% through ${row.episode.origin} · ${row.episode.name}`;
	}
	if (row.type === "review") {
		return row.subject.on === "show" ? "Reviewed the show" : `Reviewed ${row.subject.name}`;
	}
	const [episode] = row.episodes;
	return row.episodes.length === 1
		? `Watched ${episode.origin} · ${episode.name}`
		: `Watched ${row.episodes.length} episodes`;
};

export const showActivityEpisodesLabel = (summary: ShowActivitySummary) =>
	summary.episodes.total === undefined
		? `${summary.episodes.watched}`
		: `${summary.episodes.watched} / ${summary.episodes.total}`;

export const showActivityWatchesLabel = (summary: ShowActivitySummary) => `${summary.watches}`;
