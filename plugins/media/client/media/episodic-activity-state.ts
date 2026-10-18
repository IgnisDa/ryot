import {
	absorbProgressRun,
	anchorOf,
	decimalLabel,
	type MediaActivityBeatRow,
	type MediaActivityCollectionRow,
	type MediaActivityCompletionRow,
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
	optionalText,
} from "./activity-timeline";
import { formatLocalDateKey } from "./date";

export type MediaEpisodicBeat = "backlog" | "dropped" | "on_hold";

export type MediaEpisodicParentEvent = MediaActivityEventRow & {
	readonly kind: "parent";
	readonly startedOn: string | null;
	readonly dateUnknown: boolean | null;
	readonly eventSchemaSlug: MediaEpisodicBeat | "complete" | "review" | "add-to-media-library";
};

export type MediaEpisodicEpisodeEvent<Episode> = MediaActivityEventRow & {
	readonly kind: "episode";
	readonly episode: Episode;
	readonly progressPercent: number | null;
	readonly eventSchemaSlug: "review" | "progress";
};

export type MediaEpisodicCollectionEvent = {
	readonly id: string;
	readonly kind: "collection";
	readonly createdAt: string;
	readonly occurredAt: string;
	readonly eventSchemaSlug: string;
	readonly collection: { readonly id: string; readonly name: string };
};

export type MediaEpisodicActivityEvent<Episode> =
	MediaEpisodicParentEvent | MediaEpisodicEpisodeEvent<Episode> | MediaEpisodicCollectionEvent;

export type MediaEpisodicHistoryEvent<Episode> =
	| MediaEpisodicParentEvent
	| MediaEpisodicCollectionEvent
	| (Omit<MediaEpisodicEpisodeEvent<Episode>, "eventSchemaSlug"> & {
			readonly eventSchemaSlug: "review" | "progress" | "complete";
	  });

export type MediaEpisodicEpisodeVocabulary<Episode> = {
	readonly origin: (episode: Episode) => string;
	readonly order: (episode: Episode) => readonly number[];
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
	const origin = vocabulary.origin(event.episode);
	const order = vocabulary.order(event.episode);
	if (event.eventSchemaSlug === "complete") {
		return {
			...anchorOf(event, "watch"),
			type: "watch",
			source: optionalText(event.consumedOn),
			episodes: [
				{
					order,
					origin,
					id: event.episode.id,
					name: event.episode.name,
					minutes: event.timeSpent ?? event.episode.runtime ?? undefined,
				},
			],
		};
	}
	return episodeEventRow({ ...event, eventSchemaSlug: event.eventSchemaSlug }, origin, order);
};

export type MediaEpisodicWatchDayRow = {
	readonly day: string;
	readonly episodeId: string;
	readonly episodeName: string;
	readonly runtime: number | null;
	readonly minutes: number | null;
	readonly consumedOn: string | null;
};

export type MediaEpisodicActivityResult<Episode, WatchDay> = {
	readonly truncated: boolean;
	readonly watchCount: number;
	readonly watchDays: readonly WatchDay[];
	readonly events: readonly MediaEpisodicActivityEvent<Episode>[];
};

export type MediaEpisodicEpisodeValue = {
	readonly id: string;
	readonly name: string;
	readonly runtime: number | null;
};

/** What an episodic activity recipe must return once its episode rows carry `Origin`. */
export type MediaEpisodicActivityValue<Origin> = MediaEpisodicActivityResult<
	Origin & MediaEpisodicEpisodeValue,
	Origin & MediaEpisodicWatchDayRow
>;

export type MediaEpisodicWatchedEpisode = {
	readonly id: string;
	readonly name: string;
	readonly origin: string;
	readonly order: readonly number[];
	readonly minutes: number | undefined;
};

export type MediaEpisodicReviewSubject =
	| { readonly on: "parent" }
	| { readonly on: "episode"; readonly name: string; readonly origin: string };

export type MediaEpisodicWatchRow = {
	readonly key: string;
	readonly dateKey: string;
	readonly type: "watch";
	readonly occurredAt: string;
	readonly source: string | undefined;
	readonly episodes: NonEmpty<MediaEpisodicWatchedEpisode>;
	readonly run?: MediaActivityProgressRun;
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
};

export type MediaEpisodicReviewRow = MediaActivityReviewRow<MediaEpisodicReviewSubject>;

export type MediaEpisodicRow =
	| MediaEpisodicWatchRow
	| MediaEpisodicReviewRow
	| MediaEpisodicProgressRow
	| MediaActivityCollectionRow
	| MediaActivityCompletionRow
	| MediaActivityLibraryRow
	| MediaActivityBeatRow<MediaEpisodicBeat>;

export type MediaEpisodicTimeline = MediaActivityTimeline<MediaEpisodicRow>;

export type MediaEpisodicCoverageRow = {
	readonly key: string;
	readonly label: string;
	readonly watched: number;
	readonly total: number | undefined;
	readonly percent: number | undefined;
};

export type MediaEpisodicCoverage = {
	readonly rows: readonly MediaEpisodicCoverageRow[];
	readonly minutes: { readonly total: number; readonly missing: number };
	readonly headline: { readonly watched: number; readonly total: number | undefined };
};

export type MediaEpisodicSummary = {
	readonly watches: number;
	readonly span: MediaActivitySpan;
	readonly minutes: { readonly total: number; readonly missing: number };
	readonly episodes: { readonly watched: number; readonly total: number | undefined };
};

export type MediaEpisodicView = {
	readonly summary: MediaEpisodicSummary;
	readonly timeline: MediaEpisodicTimeline;
	readonly coverage: readonly MediaEpisodicCoverageRow[];
};

export type MediaEpisodicActivityCopy = {
	readonly libraryLabel: string;
	readonly beats: Record<MediaEpisodicBeat, string>;
	readonly rowLabels: {
		readonly review: string;
		readonly watched: string;
		readonly completion: string;
	};
};

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
): NonEmpty<MediaEpisodicWatchedEpisode> | undefined =>
	nonEmpty([...episodes].sort((left, right) => compareOrder(left.order, right.order)));

const watchDayRows = <WatchDay extends MediaEpisodicWatchDayRow>(
	watchDays: readonly WatchDay[],
	vocabulary: MediaEpisodicEpisodeVocabulary<WatchDay>,
) => {
	const days = new Map<string, Map<string, MediaEpisodicWatchedEpisode>>();
	const sources = new Map<string, string>();
	for (const watch of watchDays) {
		const episodes = days.get(watch.day) ?? new Map<string, MediaEpisodicWatchedEpisode>();
		if (!episodes.has(watch.episodeId)) {
			episodes.set(watch.episodeId, {
				id: watch.episodeId,
				name: watch.episodeName,
				order: vocabulary.order(watch),
				origin: vocabulary.origin(watch),
				minutes: watch.minutes ?? watch.runtime ?? undefined,
			});
		}
		days.set(watch.day, episodes);
		const source = optionalText(watch.consumedOn);
		if (source !== undefined && !sources.has(watch.day)) {
			sources.set(watch.day, source);
		}
	}
	return [...days.entries()].flatMap(([day, episodes]): readonly MediaEpisodicWatchRow[] => {
		const listed = sortedEpisodes([...episodes.values()]);
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
	origin: string,
	order: readonly number[],
): MediaEpisodicRow => {
	if (event.eventSchemaSlug === "review") {
		return mediaReviewRow(event, { origin, on: "episode", name: event.episode.name });
	}
	return {
		...anchorOf(event, "progress"),
		type: "progress",
		source: optionalText(event.consumedOn),
		percent: event.progressPercent ?? undefined,
		episode: {
			order,
			origin,
			id: event.episode.id,
			name: event.episode.name,
			minutes: event.timeSpent ?? event.episode.runtime ?? undefined,
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
): MediaEpisodicRow | undefined => {
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
		return episodes === undefined ? undefined : { ...current, episodes };
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
}): MediaEpisodicView | undefined => {
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
			minutes: coverage.minutes,
			watches: result.watchCount,
			episodes: { total: coverage.headline.total, watched: coverage.headline.watched },
		},
	};
};

export const mediaEpisodicRowLabel = (
	row: MediaEpisodicRow,
	copy: MediaEpisodicActivityCopy,
): string => {
	if (row.type === "completion") {
		return copy.rowLabels.completion;
	}
	if (row.type === "collection") {
		return mediaCollectionRowLabel(row);
	}
	if (row.type === "media-library") {
		return copy.libraryLabel;
	}
	if (row.type === "beat") {
		return copy.beats[row.beat];
	}
	if (row.type === "progress") {
		return row.percent === undefined
			? `Part-way through ${row.episode.origin} · ${row.episode.name}`
			: `${decimalLabel(row.percent)}% through ${row.episode.origin} · ${row.episode.name}`;
	}
	if (row.type === "review") {
		return row.subject.on === "parent" ? copy.rowLabels.review : `Reviewed ${row.subject.name}`;
	}
	const [episode] = row.episodes;
	return row.episodes.length === 1
		? `${copy.rowLabels.watched} ${episode.origin} · ${episode.name}`
		: `${copy.rowLabels.watched} ${row.episodes.length} episodes`;
};

export const mediaEpisodicEpisodesLabel = (summary: MediaEpisodicSummary) =>
	summary.episodes.total === undefined
		? `${summary.episodes.watched}`
		: `${summary.episodes.watched} / ${summary.episodes.total}`;

export const mediaEpisodicActivityFigures = (
	summary: MediaEpisodicSummary,
	labels: { readonly time: string; readonly watches: string; readonly episodes: string },
): readonly MediaActivityFigure[] => {
	const span = mediaActivitySpanLabel(summary.span);
	return [
		{ detail: undefined, label: labels.episodes, value: mediaEpisodicEpisodesLabel(summary) },
		...(summary.watches === 0
			? []
			: [{ detail: undefined, label: labels.watches, value: `${summary.watches}` }]),
		{ detail: undefined, label: labels.time, value: mediaActivityTimeLabel(summary.minutes) },
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

/** Contiguous stretches of sorted episodes, each shown from its first to its last origin label. */
export const mediaEpisodicRangeSummary = (episodes: readonly MediaEpisodicWatchedEpisode[]) => {
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
	return ranges
		.map((range) => {
			const first = range[0]?.origin;
			const last = range.at(-1)?.origin;
			return range.length === 1 || first === last ? first : `${first} – ${last}`;
		})
		.join(", ");
};

/** The episode span and count watched across rows ordered newest first, or `undefined` without watches. */
export const mediaEpisodicMonthSummary = (rows: readonly MediaEpisodicRow[]) => {
	const watches = rows.flatMap((row) => (row.type === "watch" ? [row] : []));
	const latest = watches.at(0)?.episodes.at(-1);
	const earliest = watches.at(-1)?.episodes[0];
	if (latest === undefined || earliest === undefined) {
		return undefined;
	}
	const count = watches.reduce((total, row) => total + row.episodes.length, 0);
	const span =
		earliest.origin === latest.origin ? latest.origin : `${earliest.origin} – ${latest.origin}`;
	return `${span} · ${count === 1 ? "1 episode" : `${count} episodes`}`;
};
