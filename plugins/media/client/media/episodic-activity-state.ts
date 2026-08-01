import {
	anchorOf,
	decimalLabel,
	mediaActivityRowsView,
	mediaBeatRow,
	mediaCollectionRow,
	mediaCollectionRowLabel,
	mediaCompletionRow,
	mediaLibraryRow,
	mediaReviewRow,
	nonEmpty,
	optionalText,
	type MediaActivityBeatRow,
	type MediaActivityCollectionRow,
	type MediaActivityCompletionRow,
	type MediaActivityEventRow,
	type MediaActivityLibraryRow,
	type MediaActivityReviewRow,
	type MediaActivitySpan,
	type MediaActivityTimeline,
	type NonEmpty,
} from "./activity-timeline";
import { formatLocalDateKey } from "./date";

export type MediaEpisodicBeat = "backlog" | "dropped" | "on_hold";

export type MediaEpisodicParentEvent = MediaActivityEventRow & {
	readonly kind: "parent";
	readonly startedOn: string | null;
	readonly completedOn: string | null;
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
	| MediaEpisodicParentEvent
	| MediaEpisodicEpisodeEvent<Episode>
	| MediaEpisodicCollectionEvent;

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
};

export type MediaEpisodicProgressRow = {
	readonly key: string;
	readonly dateKey: string;
	readonly type: "progress";
	readonly occurredAt: string;
	readonly source: string | undefined;
	readonly percent: number | undefined;
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

const watchDayRows = <WatchDay extends MediaEpisodicWatchDayRow>(
	watchDays: readonly WatchDay[],
	episodeOrigin: (origin: WatchDay) => string,
) => {
	const days = new Map<string, Map<string, MediaEpisodicWatchedEpisode>>();
	const sources = new Map<string, string>();
	for (const watch of watchDays) {
		const episodes = days.get(watch.day) ?? new Map<string, MediaEpisodicWatchedEpisode>();
		if (!episodes.has(watch.episodeId)) {
			episodes.set(watch.episodeId, {
				id: watch.episodeId,
				name: watch.episodeName,
				origin: episodeOrigin(watch),
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

export const mediaEpisodicActivityView = <Origin>(input: {
	readonly coverage: MediaEpisodicCoverage;
	readonly episodeOrigin: (origin: Origin) => string;
	readonly result: MediaEpisodicActivityResult<
		Origin & MediaEpisodicEpisodeValue,
		Origin & MediaEpisodicWatchDayRow
	>;
}): MediaEpisodicView | undefined => {
	const { result, coverage } = input;
	const eventRows = result.events.map((event): MediaEpisodicRow => {
		if (event.kind === "parent") {
			return parentEventRow(event);
		}
		if (event.kind === "collection") {
			return mediaCollectionRow(event);
		}
		return episodeEventRow(event, input.episodeOrigin(event.episode));
	});
	const view = mediaActivityRowsView(
		[...watchDayRows(result.watchDays, input.episodeOrigin), ...eventRows],
		episodicPredicates,
		result.truncated,
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
