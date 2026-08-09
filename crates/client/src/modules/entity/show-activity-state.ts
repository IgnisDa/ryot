import type { ShowActivityEvent, ShowActivityResult } from "@ryot-app/media-plugin/query-recipes";
import { Match } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult, type MappedRyotQLResultState } from "@/api/ryotql";
import {
	formatLocalDateKey,
	formatLocalDateLabel,
	formatLocalMonthDayLabel,
	formatLocalYearLabel,
	localDayCount,
} from "@/modules/ui/date";

import {
	isSpecialsSeason,
	optionalText,
	seasonOrder,
	showEpisodeOriginLabel,
	showSeasonOriginLabel,
} from "./show-episodes-state";

type ParentEvent = Extract<ShowActivityEvent, { kind: "parent" }>;
type EpisodeEvent = Extract<ShowActivityEvent, { kind: "episode" }>;
type CollectionEvent = Extract<ShowActivityEvent, { kind: "collection" }>;

type ActivityBeat = Exclude<ParentEvent["eventSchemaSlug"], "review" | "complete">;

type ActivityAnchor = {
	readonly key: string;
	readonly dateKey: string;
	readonly occurredAt: string;
};

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

export type ShowActivityWatchRow = ActivityAnchor & {
	readonly type: "watch";
	readonly source: string | undefined;
	readonly episodes: readonly [ShowActivityWatchedEpisode, ...ShowActivityWatchedEpisode[]];
};

type ShowActivityProgressRow = ActivityAnchor & {
	readonly type: "progress";
	readonly percent: number | undefined;
	readonly source: string | undefined;
	readonly episode: ShowActivityWatchedEpisode;
};

type ShowActivityBeatRow = ActivityAnchor & {
	readonly type: "beat";
	readonly beat: ActivityBeat;
};

type ShowActivityCompletionRow = ActivityAnchor & {
	readonly type: "completion";
	readonly minutes: number | undefined;
	readonly startedOn: string | undefined;
	readonly completedOn: string | undefined;
};

export type ShowActivityReviewRow = ActivityAnchor & {
	readonly type: "review";
	readonly rating: number | undefined;
	readonly subject: ShowActivityReviewSubject;
	readonly body: { readonly text: string; readonly isSpoiler: boolean } | undefined;
};

export type ShowActivityCollectionRow = ActivityAnchor & {
	readonly name: string;
	readonly type: "collection";
	readonly change: "added" | "removed";
};

export type ShowActivityRow =
	| ShowActivityBeatRow
	| ShowActivityWatchRow
	| ShowActivityReviewRow
	| ShowActivityProgressRow
	| ShowActivityCompletionRow
	| ShowActivityCollectionRow;

type NonEmpty<Value> = readonly [Value, ...Value[]];

const nonEmpty = <Value>(values: readonly Value[]): NonEmpty<Value> | undefined => {
	const [head, ...tail] = values;
	return head === undefined ? undefined : [head, ...tail];
};

export type ShowActivityCompletedWatch = {
	readonly key: string;
	readonly rows: NonEmpty<ShowActivityRow>;
	readonly completion: ShowActivityCompletionRow;
};

export type ShowActivityTimeline =
	| { readonly layout: "flat"; readonly rows: NonEmpty<ShowActivityRow> }
	| {
			readonly layout: "segmented";
			readonly open: NonEmpty<ShowActivityRow> | undefined;
			readonly completed: readonly [
				ShowActivityCompletedWatch,
				ShowActivityCompletedWatch,
				...ShowActivityCompletedWatch[],
			];
	  };

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

type ShowActivitySpan =
	| { readonly bound: "partial"; readonly latest: string }
	| {
			readonly days: number;
			readonly bound: "full";
			readonly latest: string;
			readonly earliest: string;
	  };

export type ShowActivitySummary = {
	readonly watches: number;
	readonly span: ShowActivitySpan;
	readonly minutes: { readonly total: number; readonly missing: number };
	readonly episodes: { readonly watched: number; readonly total: number | undefined };
};

export type ShowActivityView = {
	readonly summary: ShowActivitySummary;
	readonly coverage: ShowActivityCoverage;
	readonly timeline: ShowActivityTimeline;
};

export type ShowActivityState = MappedRyotQLResultState<
	{ readonly status: "empty" } | { readonly status: "ready"; readonly view: ShowActivityView }
>;

type ShowActivityFailure = Pick<
	Extract<ShowActivityState, { status: "transport-error" | "malformed" }>,
	"status"
>;

const watchedEpisode = (event: EpisodeEvent): ShowActivityWatchedEpisode => ({
	id: event.episode.id,
	name: event.episode.name,
	seasonNumber: event.episode.seasonNumber,
	episodeNumber: event.episode.episodeNumber,
	origin: showEpisodeOriginLabel(event.episode),
	minutes: event.timeSpent ?? event.episode.runtime ?? undefined,
});

const anchorOf = (event: ShowActivityEvent, prefix: string): ActivityAnchor => ({
	key: `${prefix}-${event.id}`,
	occurredAt: event.occurredAt,
	dateKey: formatLocalDateKey(event.occurredAt),
});

const reviewBody = (event: ShowActivityEvent) => {
	const text = optionalText(event.text);
	return text === undefined ? undefined : { text, isSpoiler: event.isSpoiler === true };
};

const parentBeatRow = (event: ParentEvent, beat: ActivityBeat): ShowActivityBeatRow => ({
	...anchorOf(event, "beat"),
	beat,
	type: "beat",
});

const parentEventRow = (event: ParentEvent): ShowActivityRow =>
	Match.value(event.eventSchemaSlug).pipe(
		Match.when("complete", () => ({
			...anchorOf(event, "completion"),
			type: "completion" as const,
			minutes: event.timeSpent ?? undefined,
			startedOn: event.startedOn ?? undefined,
			completedOn: event.completedOn ?? undefined,
		})),
		Match.when("review", () => ({
			...anchorOf(event, "review"),
			type: "review" as const,
			body: reviewBody(event),
			subject: { on: "show" as const },
			rating: event.rating ?? undefined,
		})),
		Match.when("backlog", (beat) => parentBeatRow(event, beat)),
		Match.when("dropped", (beat) => parentBeatRow(event, beat)),
		Match.when("on_hold", (beat) => parentBeatRow(event, beat)),
		Match.exhaustive,
	);

const episodeEventRow = (event: EpisodeEvent): ShowActivityRow =>
	Match.value(event.eventSchemaSlug).pipe(
		Match.when("review", () => ({
			...anchorOf(event, "review"),
			type: "review" as const,
			body: reviewBody(event),
			rating: event.rating ?? undefined,
			subject: {
				on: "episode" as const,
				name: event.episode.name,
				origin: showEpisodeOriginLabel(event.episode),
			},
		})),
		Match.when("progress", () => ({
			...anchorOf(event, "progress"),
			type: "progress" as const,
			episode: watchedEpisode(event),
			percent: event.progressPercent ?? undefined,
			source: optionalText(event.consumedOn),
		})),
		Match.exhaustive,
	);

const collectionEventRow = (event: CollectionEvent): ShowActivityRow => ({
	...anchorOf(event, "collection"),
	type: "collection" as const,
	name: event.collection.name,
	change: event.eventSchemaSlug === "add-entity-to-collection" ? "added" : "removed",
});

const activityRow = (event: ShowActivityEvent) =>
	Match.value(event).pipe(
		Match.when({ kind: "parent" }, parentEventRow),
		Match.when({ kind: "episode" }, episodeEventRow),
		Match.when({ kind: "collection" }, collectionEventRow),
		Match.exhaustive,
	);

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
						episodes: listed,
						occurredAt: day,
						key: `watch-${day}`,
						source: sources.get(day),
						dateKey: formatLocalDateKey(day),
					},
				];
	});
};

const isWatching = (row: ShowActivityRow) => row.type === "watch" || row.type === "progress";

type OpenWatch = { readonly completion: ShowActivityCompletionRow; rows: ShowActivityRow[] };

const takeTrailingSameInstant = (
	rows: ShowActivityRow[],
	occurredAt: string,
	keep: number,
): ShowActivityRow[] => {
	const taken: ShowActivityRow[] = [];
	while (rows.length > keep && rows.at(-1)?.occurredAt === occurredAt) {
		const row = rows.pop();
		if (row !== undefined) {
			taken.unshift(row);
		}
	}
	return taken;
};

const segmentRows = (rows: readonly ShowActivityRow[]) => {
	const completed: ShowActivityCompletedWatch[] = [];
	const pending: ShowActivityRow[] = [];
	let current: OpenWatch | undefined = undefined;
	const close = () => {
		if (current !== undefined) {
			completed.push({
				key: current.completion.key,
				completion: current.completion,
				rows: [current.completion, ...current.rows.slice(1)],
			});
		}
	};
	for (const row of rows) {
		if (row.type === "completion") {
			const sameInstant: ShowActivityRow[] =
				current === undefined
					? takeTrailingSameInstant(pending, row.occurredAt, 0)
					: takeTrailingSameInstant(current.rows, row.occurredAt, 1);
			close();
			current = { completion: row, rows: [row, ...sameInstant] };
			continue;
		}
		if (current === undefined) {
			pending.push(row);
		} else {
			current.rows.push(row);
		}
	}
	close();
	return { open: pending, completed };
};

const foldSegments = (rows: readonly ShowActivityRow[]) => {
	const { open, completed } = segmentRows(rows);
	const newest = completed.at(0);
	if (open.length === 0 || newest === undefined || open.some(isWatching)) {
		return { open, completed };
	}
	const merged: ShowActivityCompletedWatch = {
		...newest,
		rows: nonEmpty([...open, ...newest.rows]) ?? newest.rows,
	};
	return { open: [], completed: [merged, ...completed.slice(1)] };
};

const showActivityTimeline = (
	rows: readonly ShowActivityRow[],
): ShowActivityTimeline | undefined => {
	const { open, completed } = foldSegments(rows);
	const first = completed.at(0);
	const second = completed.at(1);
	if (first === undefined || second === undefined) {
		const flat = nonEmpty(rows);
		return flat === undefined ? undefined : { layout: "flat", rows: flat };
	}
	return {
		layout: "segmented",
		open: nonEmpty(open),
		completed: [first, second, ...completed.slice(2)],
	};
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
		specials: rows.filter(isSpecialsSeason).map(seasonCoverage).at(0),
		seasons: seasons.map(seasonCoverage),
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

const activitySpan = (rows: NonEmpty<ShowActivityRow>, truncated: boolean): ShowActivitySpan => {
	const [latestRow] = rows;
	const latest = latestRow.occurredAt;
	const earliest = rows.at(-1)?.occurredAt ?? latest;
	if (truncated) {
		return { bound: "partial", latest };
	}
	return { bound: "full", latest, earliest, days: localDayCount(earliest, latest) };
};

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
	const timeline = showActivityTimeline(rows);
	if (timeline === undefined || spanned === undefined) {
		return undefined;
	}
	const coverage = showActivityCoverage(result);
	return {
		coverage,
		timeline,
		summary: showActivitySummary({ result, coverage, rows: spanned }),
	};
};

export const mapShowActivity = (
	result: AsyncResult.AsyncResult<ShowActivityResult, unknown>,
): ShowActivityState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const view = showActivityView(state.value);
	return view === undefined ? { status: "empty" } : { status: "ready", view };
};

export const showActivityError = (state: ShowActivityFailure) => ({
	title: "Unable to load activity",
	detail:
		state.status === "transport-error"
			? "Your recorded activity could not be loaded. Check your connection and try again."
			: "This activity came back in a form that could not be displayed. Try again later.",
});

const decimalLabel = (value: number) => String(Math.round(value * 100) / 100);

export const showActivityDurationLabel = (minutes: number) => {
	const total = Math.max(Math.round(minutes), 0);
	const rest = total % 60;
	const hours = Math.floor(total / 60);
	if (hours === 0) {
		return `${rest}m`;
	}
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

export const showActivityDateLabel = (row: ShowActivityRow) => formatLocalDateLabel(row.occurredAt);

export const showActivityRowLabel = (row: ShowActivityRow) =>
	Match.value(row).pipe(
		Match.when({ type: "completion" }, () => "Finished the show"),
		Match.when({ type: "collection" }, (entry) =>
			entry.change === "added"
				? `Added to the ${entry.name} collection`
				: `Removed from the ${entry.name} collection`,
		),
		Match.when({ type: "beat" }, (entry) =>
			Match.value(entry.beat).pipe(
				Match.when("backlog", () => "Added to backlog"),
				Match.when("dropped", () => "Stopped watching"),
				Match.when("on_hold", () => "Put this show on hold"),
				Match.exhaustive,
			),
		),
		Match.when({ type: "progress" }, (entry) =>
			entry.percent === undefined
				? `Part-way through ${entry.episode.origin} · ${entry.episode.name}`
				: `${decimalLabel(entry.percent)}% through ${entry.episode.origin} · ${entry.episode.name}`,
		),
		Match.when({ type: "review" }, (entry) =>
			entry.subject.on === "show" ? "Reviewed the show" : `Reviewed ${entry.subject.name}`,
		),
		Match.when({ type: "watch" }, (entry) => {
			const [episode] = entry.episodes;
			return entry.episodes.length === 1
				? `Watched ${episode.origin} · ${episode.name}`
				: `Watched ${entry.episodes.length} episodes`;
		}),
		Match.exhaustive,
	);

export const showActivityRatingLabel = (rating: number) => `${decimalLabel(rating)} / 100`;

export const showActivityEpisodesLabel = (summary: ShowActivitySummary) =>
	summary.episodes.total === undefined
		? `${summary.episodes.watched}`
		: `${summary.episodes.watched} / ${summary.episodes.total}`;

export const showActivityWatchesLabel = (summary: ShowActivitySummary) => `${summary.watches}`;

export const showActivityTimeLabel = (summary: ShowActivitySummary) => {
	const label = showActivityDurationLabel(summary.minutes.total);
	return summary.minutes.missing > 0 ? `${label}+` : label;
};

const spanRangeLabel = (earliest: string, latest: string) => {
	if (formatLocalDateKey(earliest) === formatLocalDateKey(latest)) {
		return formatLocalDateLabel(latest);
	}
	return formatLocalYearLabel(earliest) === formatLocalYearLabel(latest)
		? `${formatLocalMonthDayLabel(earliest)} – ${formatLocalDateLabel(latest)}`
		: `${formatLocalDateLabel(earliest)} – ${formatLocalDateLabel(latest)}`;
};

export const showActivitySpanLabel = (summary: ShowActivitySummary) => {
	if (summary.span.bound === "partial") {
		return {
			label: "Latest",
			detail: undefined,
			value: formatLocalDateLabel(summary.span.latest),
		};
	}
	const { days, earliest, latest } = summary.span;
	return {
		label: "Span",
		detail: spanRangeLabel(earliest, latest),
		value: days === 1 ? "1 day" : `${days} days`,
	};
};
