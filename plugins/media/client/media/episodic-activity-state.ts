import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import type { SelectedRow } from "@ryot-app/plugin-client-sdk/ryotql";

import { consumedOnLabel, mergeConsumedOn } from "../../shared/consumed-on";
import type { mediaReviewEventSelection } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import type { MediaCopy, MediaText } from "../messages";
import { seasonMessage } from "./activity-log/state";
import {
	absorbProgressRun,
	anchorOf,
	eventRef,
	joinEvents,
	type MediaActivityBeatRow,
	type MediaActivityCollectionRow,
	type MediaActivityCompletionRow,
	type MediaActivityEventRef,
	type MediaActivityEventRow,
	type MediaActivityFigure,
	type MediaActivityLibraryRow,
	type MediaActivityProgressRun,
	type MediaActivityReviewRow,
	mediaActivityRowsView,
	type MediaActivitySpan,
	mediaActivitySpanLabel,
	mediaActivityTimeLabel,
	type MediaActivityTimeline,
	mediaBeatRow,
	mediaCollectionRow,
	mediaCollectionRowLabel,
	mediaCompletionRow,
	mediaLibraryRow,
	mediaReviewRow,
	mergeProgressRuns,
	type NonEmpty,
	nonEmpty,
} from "./activity-timeline";

export type MediaEpisodicBeat = "backlog" | "dropped" | "on_hold";

export type MediaEpisodicActivityEvent<Episode> =
	| MediaEpisodicParentEvent
	| MediaEpisodicSeasonEvent
	| MediaEpisodicCollectionEvent
	| MediaEpisodicEpisodeEvent<Episode>;

export type MediaEpisodicParentEvent = MediaActivityEventRow & {
	readonly kind: "parent";
	readonly startedOn: null | string;
	readonly dateUnknown: null | boolean;
	readonly eventSchemaSlug: "review" | "complete" | MediaEpisodicBeat | "add-to-media-library";
};

export type MediaEpisodicCollectionEvent = {
	readonly id: string;
	readonly createdAt: string;
	readonly kind: "collection";
	readonly occurredAt: string;
	readonly eventSchemaSlug: string;
	readonly collection: { readonly id: string; readonly name: string };
};

export type MediaEpisodicEpisodeEvent<Episode> = MediaActivityEventRow & {
	readonly kind: "episode";
	readonly episode: Episode;
	readonly progressPercent: null | number;
	readonly consumptionMinutes: null | number;
	readonly eventSchemaSlug: "review" | "progress";
};

export type MediaEpisodicHistoryEvent<Episode> =
	| MediaEpisodicParentEvent
	| MediaEpisodicSeasonEvent
	| MediaEpisodicCollectionEvent
	| (Omit<MediaEpisodicEpisodeEvent<Episode>, "eventSchemaSlug"> & {
			readonly eventSchemaSlug: "review" | "progress" | "complete";
	  });

type MediaEpisodicEpisodeVocabulary<Episode> = {
	readonly origin: (episode: Episode) => LocalMessage;
	readonly order: (episode: Episode) => readonly number[];
};

type MediaEpisodicSeasonEvent = SelectedRow<ReturnType<typeof mediaReviewEventSelection>> & {
	readonly kind: "season";
	readonly eventSchemaSlug: "review";
	readonly season: { readonly id: string; readonly name: string; readonly seasonNumber: number };
};

export const mediaEpisodicActivityRow = <Episode extends MediaEpisodicEpisodeValue>(
	event: MediaEpisodicHistoryEvent<Episode>,
	vocabulary: MediaEpisodicEpisodeVocabulary<Episode>,
): MediaEpisodicRow => {
	if (event.kind === "parent") {
		return parentEventRow(event);
	}
	if (event.kind === "collection") {
		return mediaCollectionRow(event);
	}
	if (event.kind === "season") {
		const name = seasonMessage(event.season.seasonNumber);
		return { ...mediaReviewRow(event, { name, on: "season" }), subjectLabel: name };
	}
	const origin = vocabulary.origin(event.episode);
	const order = vocabulary.order(event.episode);
	if (event.eventSchemaSlug === "complete") {
		return {
			...anchorOf(event, "watch"),
			type: "watch",
			consumptionEventIds: [],
			events: [eventRef(event)],
			source: consumedOnLabel(event.consumedOn),
			episodes: [
				{
					order,
					origin,
					id: event.episode.id,
					name: event.episode.name,
					minutes: event.consumptionMinutes ?? undefined,
				},
			],
		};
	}
	return episodeEventRow({ ...event, eventSchemaSlug: event.eventSchemaSlug }, origin, order);
};

export type MediaEpisodicTimeline = MediaActivityTimeline<MediaEpisodicRow>;

export type MediaEpisodicReviewRow = MediaActivityReviewRow<MediaEpisodicReviewSubject>;

export type MediaEpisodicEpisodeValue = {
	readonly id: string;
	readonly name: string;
	readonly runtime: null | number;
};

export type MediaEpisodicFigureLabels = {
	readonly time: string;
	readonly current: string;
	readonly watches: string;
	readonly episodes: string;
};

/** What an episodic activity recipe must return once its episode rows carry `Origin`. */
export type MediaEpisodicActivityValue<Origin> = MediaEpisodicActivityResult<
	Origin & MediaEpisodicEpisodeValue,
	Origin & MediaEpisodicWatchDayRow
>;

export type MediaEpisodicView = {
	readonly summary: MediaEpisodicSummary;
	readonly timeline: MediaEpisodicTimeline;
	readonly coverage: readonly MediaEpisodicCoverageRow[];
};

export type MediaEpisodicCoverage = {
	readonly rows: readonly MediaEpisodicCoverageRow[];
	readonly headline: { readonly watched: number; readonly total: number | undefined };
};

export type MediaEpisodicWatchedEpisode = {
	readonly id: string;
	readonly name: string;
	readonly origin: LocalMessage;
	readonly order: readonly number[];
	readonly minutes: number | undefined;
};

export type MediaEpisodicCoverageRow = {
	readonly key: string;
	readonly watched: number;
	readonly label: LocalMessage;
	readonly total: number | undefined;
	readonly percent: number | undefined;
};

export type MediaEpisodicRow =
	| MediaEpisodicWatchRow
	| MediaEpisodicReviewRow
	| MediaActivityLibraryRow
	| MediaEpisodicProgressRow
	| MediaActivityCollectionRow
	| MediaActivityCompletionRow
	| MediaActivityBeatRow<MediaEpisodicBeat>;

export type MediaEpisodicActivityCopy = {
	readonly libraryLabel: string;
	readonly beats: Record<MediaEpisodicBeat, string>;
	readonly rowLabels: {
		readonly review: string;
		readonly completion: string;
		readonly watched: "played" | "watched";
	};
};

export type MediaEpisodicWatchDayRow = {
	readonly day: string;
	readonly episodeId: string;
	readonly episodeName: string;
	readonly lastWatchedAt: string;
	readonly runtime: null | number;
	readonly minutes: null | number;
	readonly eventIds: readonly string[];
	readonly consumedOn: null | readonly string[];
};

export type MediaEpisodicSummary = {
	readonly watches: number;
	readonly span: MediaActivitySpan;
	readonly processing: "ready" | "failed" | "pending";
	readonly minutes: { readonly total: number; readonly missing: number };
	readonly episodes: { readonly watched: number; readonly total: number | undefined };
};

export type MediaEpisodicProgressRow = {
	readonly key: string;
	readonly dateKey: string;
	readonly type: "progress";
	readonly occurredAt: string;
	readonly source: string | undefined;
	readonly percent: number | undefined;
	readonly run?: MediaActivityProgressRun;
	readonly episode: MediaEpisodicWatchedEpisode;
	readonly events: readonly MediaActivityEventRef[];
};

export type MediaEpisodicActivityResult<Episode, WatchDay> = {
	readonly truncated: boolean;
	readonly watchCount: number;
	readonly consumptionMinutes: number;
	readonly consumptionMissing: number;
	readonly watchDays: readonly WatchDay[];
	readonly consumptionProcessing: "ready" | "failed" | "pending";
	readonly events: readonly MediaEpisodicActivityEvent<Episode>[];
};

export type MediaEpisodicWatchRow = {
	readonly key: string;
	readonly type: "watch";
	readonly dateKey: string;
	readonly absorbed?: number;
	readonly occurredAt: string;
	readonly calendarDate?: string;
	readonly dateUnknown?: boolean;
	readonly source: string | undefined;
	readonly run?: MediaActivityProgressRun;
	readonly consumptionEventIds: readonly string[];
	readonly events: readonly MediaActivityEventRef[];
	readonly episodes: NonEmpty<MediaEpisodicWatchedEpisode>;
};

type MediaEpisodicReviewSubject =
	| { readonly on: "parent" }
	| { readonly on: "season"; readonly name: LocalMessage }
	| { readonly name: string; readonly on: "episode"; readonly origin: LocalMessage };

export const mediaEpisodicCoveragePercent = (watched: number, total: number) =>
	total === 0 ? undefined : Math.min(Math.round((watched / total) * 100), 100);

const compareOrder = (left: readonly number[], right: readonly number[]) => {
	for (const [index, value] of left.entries()) {
		const difference = value - (right[index] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return left.length - right.length;
};

const sortedEpisodes = (
	episodes: readonly MediaEpisodicWatchedEpisode[],
): undefined | NonEmpty<MediaEpisodicWatchedEpisode> =>
	nonEmpty([...episodes].sort((left, right) => compareOrder(left.order, right.order)));

const watchDayRows = <WatchDay extends MediaEpisodicWatchDayRow>(
	watchDays: readonly WatchDay[],
	vocabulary: MediaEpisodicEpisodeVocabulary<WatchDay>,
) => {
	const days = new Map<
		string,
		{
			latest: string;
			readonly eventIds: string[];
			readonly consumedOn: string[][];
			readonly episodes: Map<string, MediaEpisodicWatchedEpisode>;
		}
	>();
	for (const watch of watchDays) {
		const day = days.get(watch.day) ?? {
			eventIds: [],
			consumedOn: [],
			latest: watch.lastWatchedAt,
			episodes: new Map<string, MediaEpisodicWatchedEpisode>(),
		};
		if (!day.episodes.has(watch.episodeId)) {
			day.episodes.set(watch.episodeId, {
				id: watch.episodeId,
				name: watch.episodeName,
				order: vocabulary.order(watch),
				origin: vocabulary.origin(watch),
				minutes: watch.minutes ?? undefined,
			});
		} else {
			const previous = day.episodes.get(watch.episodeId);
			if (previous !== undefined) {
				day.episodes.set(watch.episodeId, {
					...previous,
					minutes:
						previous.minutes === undefined || watch.minutes === null
							? undefined
							: previous.minutes + watch.minutes,
				});
			}
		}
		if (watch.lastWatchedAt > day.latest) {
			day.latest = watch.lastWatchedAt;
		}
		day.eventIds.push(...watch.eventIds);
		day.consumedOn.push([...(watch.consumedOn ?? [])]);
		days.set(watch.day, day);
	}
	return [...days.entries()].flatMap(
		([day, { latest, eventIds, episodes, consumedOn }]): readonly MediaEpisodicWatchRow[] => {
			const listed = sortedEpisodes([...episodes.values()]);
			return listed === undefined
				? []
				: [
						{
							events: [],
							dateKey: day,
							type: "watch",
							episodes: listed,
							calendarDate: day,
							occurredAt: latest,
							key: `watch-${day}`,
							consumptionEventIds: eventIds,
							source: consumedOnLabel(mergeConsumedOn(...consumedOn)),
						},
					];
		},
	);
};

const parentEventRow = (event: MediaEpisodicParentEvent): MediaEpisodicRow => {
	if (event.eventSchemaSlug === "add-to-media-library") {
		return mediaLibraryRow(event);
	}
	if (event.eventSchemaSlug === "complete") {
		return mediaCompletionRow(event);
	}
	if (event.eventSchemaSlug === "review") {
		return mediaReviewRow(event, { on: "parent" });
	}
	return mediaBeatRow(event, event.eventSchemaSlug);
};

const episodeEventRow = (
	event: MediaEpisodicEpisodeEvent<MediaEpisodicEpisodeValue>,
	origin: LocalMessage,
	order: readonly number[],
): MediaEpisodicRow => {
	if (event.eventSchemaSlug === "review") {
		return {
			...mediaReviewRow(event, { origin, on: "episode", name: event.episode.name }),
			subjectLabel: catalogMessage("activity.episode-name", { origin, name: event.episode.name }),
		};
	}
	return {
		...anchorOf(event, "progress"),
		type: "progress",
		events: [eventRef(event)],
		source: consumedOnLabel(event.consumedOn),
		percent: event.progressPercent ?? undefined,
		episode: {
			order,
			origin,
			id: event.episode.id,
			name: event.episode.name,
			minutes: event.consumptionMinutes ?? undefined,
		},
	};
};

const episodicPredicates = {
	isCompletion: (row: MediaEpisodicRow) => row.type === "completion",
	isWatching: (row: MediaEpisodicRow) => row.type === "watch" || row.type === "progress",
};

export const mergeEpisodicRuns = (
	current: MediaEpisodicRow,
	next: MediaEpisodicRow,
): undefined | MediaEpisodicRow => {
	if (
		current.type === "watch" &&
		next.type === "watch" &&
		current.occurredAt === next.occurredAt &&
		current.source === next.source
	) {
		const known = new Set(current.episodes.map((episode) => episode.id));
		const episodes = sortedEpisodes([
			...current.episodes,
			...next.episodes.filter((episode) => !known.has(episode.id)),
		]);
		return episodes === undefined
			? undefined
			: {
					...current,
					episodes,
					events: joinEvents(current.events, next.events),
					consumptionEventIds: [...current.consumptionEventIds, ...next.consumptionEventIds],
				};
	}
	if (
		current.type === "progress" &&
		next.type === "progress" &&
		current.episode.id === next.episode.id
	) {
		return mergeProgressRuns(current, next);
	}
	if (
		current.type === "watch" &&
		next.type === "progress" &&
		current.dateKey === next.dateKey &&
		current.episodes.some((episode) => episode.id === next.episode.id)
	) {
		return absorbProgressRun(current, next);
	}
	return undefined;
};

export const mediaEpisodicActivityView = <Origin>(input: {
	readonly coverage: MediaEpisodicCoverage;
	readonly episode: MediaEpisodicEpisodeVocabulary<Origin>;
	readonly result: MediaEpisodicActivityResult<
		Origin & MediaEpisodicEpisodeValue,
		Origin & MediaEpisodicWatchDayRow
	>;
}): undefined | MediaEpisodicView => {
	const { result, coverage } = input;
	const eventRows = result.events.map((event) => mediaEpisodicActivityRow(event, input.episode));
	const view = mediaActivityRowsView(
		[...watchDayRows(result.watchDays, input.episode), ...eventRows],
		episodicPredicates,
		result.truncated,
		mergeEpisodicRuns,
	);
	if (view === undefined) {
		return undefined;
	}
	return {
		timeline: view.timeline,
		coverage: coverage.rows,
		summary: {
			span: view.span,
			watches: result.watchCount,
			processing: result.consumptionProcessing,
			episodes: { total: coverage.headline.total, watched: coverage.headline.watched },
			minutes: { total: result.consumptionMinutes, missing: result.consumptionMissing },
		},
	};
};

export const mediaEpisodicRowLabel = (
	{ text }: MediaCopy,
	row: MediaEpisodicRow,
	copy: MediaEpisodicActivityCopy,
): string => {
	if (row.type === "completion") {
		return copy.rowLabels.completion;
	}
	if (row.type === "collection") {
		return mediaCollectionRowLabel(text, row);
	}
	if (row.type === "media-library") {
		return copy.libraryLabel;
	}
	if (row.type === "beat") {
		return copy.beats[row.beat];
	}
	if (row.type === "progress") {
		const episode = text("activity.episode-name", {
			name: row.episode.name,
			origin: row.episode.origin,
		});
		return row.percent === undefined
			? text("activity.episode-progress-unknown", { episode })
			: text("activity.episode-progress", { episode, percent: row.percent / 100 });
	}
	if (row.type === "review") {
		return row.subject.on === "parent"
			? copy.rowLabels.review
			: text("activity.row-review-named", { name: row.subject.name });
	}
	const [episode] = row.episodes;
	return row.episodes.length === 1
		? text("activity.row-watched-episode", {
				kind: copy.rowLabels.watched,
				episode: text("activity.episode-name", { name: episode.name, origin: episode.origin }),
			})
		: text("activity.row-watched-episodes", {
				count: row.episodes.length,
				kind: copy.rowLabels.watched,
			});
};

export const mediaEpisodicEpisodesLabel = (
	{ text, formatters }: MediaCopy,
	summary: MediaEpisodicSummary,
) =>
	summary.episodes.total === undefined
		? formatters.number().format(summary.episodes.watched)
		: text("activity.episodes-of", {
				total: summary.episodes.total,
				watched: summary.episodes.watched,
			});

export const mediaEpisodicActivityFigures = (
	copy: MediaCopy,
	summary: MediaEpisodicSummary,
	labels: MediaEpisodicFigureLabels,
): readonly MediaActivityFigure[] => {
	const { text, formatters } = copy;
	const span = mediaActivitySpanLabel(text, formatters, summary.span);
	const current = summary.watches === 0 ? undefined : labels.current;
	return [
		{ detail: current, label: labels.episodes, value: mediaEpisodicEpisodesLabel(copy, summary) },
		...(summary.watches === 0 || summary.processing !== "ready"
			? []
			: [
					{
						detail: undefined,
						label: labels.watches,
						value: formatters.number().format(summary.watches),
					},
				]),
		...(summary.processing === "ready"
			? [
					{
						label: labels.time,
						detail: text("activity.figure-lifetime"),
						value: mediaActivityTimeLabel(formatters, summary.minutes),
					},
				]
			: [
					{
						detail: undefined,
						label: text("activity.figure-consumption"),
						value:
							summary.processing === "failed"
								? text("activity.figure-repair-failed")
								: text("activity.figure-updating"),
					},
				]),
		{ label: span.label, value: span.value, detail: span.detail },
	];
};

const MAX_INLINE_EPISODES = 4;

export const mediaEpisodicEpisodesAreCollapsed = (episodes: readonly unknown[]) =>
	episodes.length > MAX_INLINE_EPISODES;

const continuesRun = (previous: MediaEpisodicWatchedEpisode, next: MediaEpisodicWatchedEpisode) => {
	const lastIndex = previous.order.length - 1;
	return (
		previous.order.length === next.order.length &&
		previous.order.every((value, index) =>
			index === lastIndex ? next.order[index] === value + 1 : next.order[index] === value,
		)
	);
};

const sameMessage = (left: LocalMessage, right: LocalMessage) =>
	JSON.stringify(left) === JSON.stringify(right);

/** Contiguous stretches of sorted episodes, each shown from its first to its last origin label. */
export const mediaEpisodicRangeSummary = (
	{ text, local, formatters }: MediaCopy,
	episodes: readonly MediaEpisodicWatchedEpisode[],
) => {
	const ranges: MediaEpisodicWatchedEpisode[][] = [];
	for (const episode of episodes) {
		const range = ranges.at(-1);
		const previous = range?.at(-1);
		if (range !== undefined && previous !== undefined && continuesRun(previous, episode)) {
			range.push(episode);
		} else {
			ranges.push([episode]);
		}
	}
	return formatters.list({ type: "unit", style: "short" }).format(
		ranges
			.map((range) => {
				const first = range[0]?.origin;
				const last = range.at(-1)?.origin;
				if (first === undefined || last === undefined) {
					return undefined;
				}
				return range.length === 1 || sameMessage(first, last)
					? local(first)
					: text("timeline.span-range", { end: last, start: first });
			})
			.filter((label) => label !== undefined),
	);
};

/** The episode span and count watched across rows ordered newest first, or `undefined` without watches. */
export const mediaEpisodicMonthSummary = (text: MediaText, rows: readonly MediaEpisodicRow[]) => {
	const watches = rows.flatMap((row) => (row.type === "watch" ? [row] : []));
	const latest = watches.at(0)?.episodes.at(-1);
	const earliest = watches.at(-1)?.episodes[0];
	if (latest === undefined || earliest === undefined) {
		return undefined;
	}
	const count = watches.reduce((total, row) => total + row.episodes.length, 0);
	const span = sameMessage(earliest.origin, latest.origin)
		? latest.origin
		: text("timeline.span-range", { end: latest.origin, start: earliest.origin });
	return text("activity.month-summary", { span, count });
};
