import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import type { Formatters, RyotQueryResult } from "@ryot-app/plugin-client-sdk/react";
import type { SelectedRow } from "@ryot-app/plugin-client-sdk/ryotql";
import { formatDuration } from "@ryot-app/plugin-ui-sdk";
import { formatDateLabel } from "@ryot-app/plugin-ui-sdk/datetime";

import type { MediaPosition } from "../../shared/consumption";
import type {
	mediaActivityEventSelection,
	mediaEventSnapshotSelection,
	mediaReviewEventSelection,
} from "../../shared/media-recipes";
import type { MediaText } from "../messages";
import {
	formatLocalDateKey,
	formatLocalMonthDayLabel,
	formatLocalYearLabel,
	localDayCount,
} from "./date";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";

export type NonEmpty<Value> = readonly [Value, ...Value[]];

export type MediaActivityRunMerge<Row> = (current: Row, next: Row) => Row | undefined;

export type MediaActivityLibraryRow = ActivityAnchor & { readonly type: "media-library" };

/** A stored event as a row last saw it, enough to edit or delete it under a precondition. */
export type MediaActivityEventRef = SelectedRow<ReturnType<typeof mediaEventSnapshotSelection>>;

export type MediaActivityEventRow = SelectedRow<ReturnType<typeof mediaActivityEventSelection>>;

export type MediaActivityProgressRun = {
	readonly updates: number;
	readonly fromPercent: number | undefined;
};

export type MediaActivityFigure = {
	readonly label: string;
	readonly value: string;
	readonly detail: string | undefined;
};

export type MediaActivityState<View> = MappedRyotQueryState<
	{ readonly status: "empty" } | { readonly view: View; readonly status: "ready" }
>;

export type MediaActivityCollectionRow = ActivityAnchor & {
	readonly name: string;
	readonly type: "collection";
	readonly change: "added" | "removed";
};

export type MediaActivityCompletedWatch<Row extends ActivityAnchor> = {
	readonly key: string;
	readonly completion: Row;
	readonly rows: NonEmpty<Row>;
};

export type ActivityRowPredicates<Row extends ActivityAnchor> = {
	readonly isWatching: (row: Row) => boolean;
	readonly isCompletion: (row: Row) => boolean;
};

export type MediaActivityBeatRow<Beat extends string> = ActivityAnchor & {
	readonly beat: Beat;
	readonly type: "beat";
	readonly events: readonly MediaActivityEventRef[];
};

export type ActivityAnchor = {
	readonly key: string;
	readonly dateKey: string;
	readonly occurredAt: string;
	readonly calendarDate?: string;
	readonly dateUnknown?: boolean;
};

export type MediaActivitySpan =
	| { readonly latest: string; readonly bound: "partial" }
	| {
			readonly days: number;
			readonly bound: "full";
			readonly latest: string;
			readonly earliest: string;
	  };

export type MediaActivityRowBase = ActivityAnchor & {
	readonly type: string;
	readonly absorbed?: number;
	readonly consumptionEventIds?: readonly string[];
	readonly events?: readonly MediaActivityEventRef[];
};

export type MediaActivityCompletionRow = ActivityAnchor & {
	readonly absorbed?: number;
	readonly type: "completion";
	readonly dateUnknown: boolean;
	readonly minutes: number | undefined;
	readonly startedOn: string | undefined;
	readonly run?: MediaActivityProgressRun;
	readonly events: readonly MediaActivityEventRef[];
};

export type MediaActivityTimeline<Row extends ActivityAnchor> =
	| { readonly layout: "flat"; readonly rows: NonEmpty<Row> }
	| {
			readonly layout: "segmented";
			readonly open: undefined | NonEmpty<Row>;
			readonly completed: readonly [
				MediaActivityCompletedWatch<Row>,
				MediaActivityCompletedWatch<Row>,
				...MediaActivityCompletedWatch<Row>[],
			];
	  };

export type MediaActivityReviewRow<Subject> = ActivityAnchor & {
	readonly type: "review";
	readonly subject: Subject;
	readonly position?: MediaPosition;
	readonly rating: number | undefined;
	readonly subjectLabel?: LocalMessage;
	readonly event: MediaActivityEventRef;
	readonly events: readonly MediaActivityEventRef[];
	readonly body: undefined | { readonly text: string; readonly isSpoiler: boolean };
};

export const optionalText = (value: null | string) =>
	value === null || value.trim() === "" ? undefined : value;

export const nonEmpty = <Value>(values: readonly Value[]): undefined | NonEmpty<Value> => {
	const [head, ...tail] = values;
	return head === undefined ? undefined : [head, ...tail];
};

export const eventRef = (event: MediaActivityEventRef): MediaActivityEventRef => ({
	id: event.id,
	entityId: event.entityId,
	occurredAt: event.occurredAt,
	properties: event.properties,
	sessionEntityId: event.sessionEntityId,
});

/** Rows without record IDs, such as aggregated daily watches, stay unactionable when folded. */
export const joinEvents = (
	current: readonly MediaActivityEventRef[],
	next: readonly MediaActivityEventRef[],
) => (current.length === 0 || next.length === 0 ? [] : [...current, ...next]);

export const anchorOf = (
	event: {
		readonly id: string;
		readonly occurredAt: string;
		readonly properties?: Readonly<Record<string, unknown>>;
	},
	prefix: string,
): ActivityAnchor => {
	const calendarDate = event.properties?.["calendarDate"];
	const dateUnknown = event.properties?.["dateUnknown"] === true;
	let dateKey =
		typeof calendarDate === "string" ? calendarDate : formatLocalDateKey(event.occurredAt);
	if (dateUnknown) {
		dateKey = "date-unknown";
	}
	return {
		dateKey,
		...(dateUnknown ? { dateUnknown: true } : {}),
		key: `${prefix}-${event.id}`,
		occurredAt: event.occurredAt,
		...(typeof calendarDate === "string" ? { calendarDate } : {}),
	};
};

export const reviewBody = (event: {
	readonly text: null | string;
	readonly isSpoiler: null | boolean;
}) => {
	const text = optionalText(event.text);
	return text === undefined ? undefined : { text, isSpoiler: event.isSpoiler === true };
};

export const mediaCompletionRow = (
	event: MediaActivityEventRow & {
		readonly startedOn: null | string;
		readonly dateUnknown: null | boolean;
	},
): MediaActivityCompletionRow => {
	const dateUnknown = event.dateUnknown === true;
	const anchor = anchorOf(event, "completion");
	return {
		...anchor,
		dateUnknown,
		type: "completion",
		events: [eventRef(event)],
		minutes: event.timeSpent ?? undefined,
		startedOn: event.startedOn ?? undefined,
		dateKey: dateUnknown ? "date-unknown" : anchor.dateKey,
	};
};

export const mediaReviewRow = <Subject>(
	event: SelectedRow<ReturnType<typeof mediaReviewEventSelection>>,
	subject: Subject,
): MediaActivityReviewRow<Subject> => ({
	...anchorOf(event, "review"),
	subject,
	type: "review",
	event: eventRef(event),
	body: reviewBody(event),
	events: [eventRef(event)],
	rating: event.rating ?? undefined,
});

export const mediaBeatRow = <Beat extends string>(
	event: MediaActivityEventRef,
	beat: Beat,
): MediaActivityBeatRow<Beat> => ({
	...anchorOf(event, "beat"),
	beat,
	type: "beat",
	events: [eventRef(event)],
});

export const mediaCollectionRow = (event: {
	readonly id: string;
	readonly occurredAt: string;
	readonly eventSchemaSlug: string;
	readonly collection: { readonly name: string };
}): MediaActivityCollectionRow => ({
	...anchorOf(event, "collection"),
	type: "collection",
	name: event.collection.name,
	change: event.eventSchemaSlug === "add-entity-to-collection" ? "added" : "removed",
});

export const mediaLibraryRow = (event: {
	readonly id: string;
	readonly occurredAt: string;
}): MediaActivityLibraryRow => ({ ...anchorOf(event, "media-library"), type: "media-library" });

const takeTrailingSameInstant = <Row extends ActivityAnchor>(
	rows: Row[],
	occurredAt: string,
	keep: number,
): Row[] => {
	const taken: Row[] = [];
	while (rows.length > keep && rows.at(-1)?.occurredAt === occurredAt) {
		const row = rows.pop();
		if (row !== undefined) {
			taken.unshift(row);
		}
	}
	return taken;
};

const segmentRows = <Row extends ActivityAnchor>(
	rows: readonly Row[],
	isCompletion: (row: Row) => boolean,
) => {
	const completed: MediaActivityCompletedWatch<Row>[] = [];
	const pending: Row[] = [];
	let current: undefined | { rows: Row[]; readonly completion: Row } = undefined;
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
		if (isCompletion(row)) {
			const sameInstant: Row[] =
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
	return { completed, open: pending };
};

const foldSegments = <Row extends ActivityAnchor>(
	rows: readonly Row[],
	predicates: ActivityRowPredicates<Row>,
) => {
	const { open, completed } = segmentRows(rows, predicates.isCompletion);
	const newest = completed.at(0);
	if (open.length === 0 || newest === undefined || open.some(predicates.isWatching)) {
		return { open, completed };
	}
	const merged: MediaActivityCompletedWatch<Row> = {
		...newest,
		rows: nonEmpty([...open, ...newest.rows]) ?? newest.rows,
	};
	return { open: [], completed: [merged, ...completed.slice(1)] };
};

export const mediaActivityTimeline = <Row extends ActivityAnchor>(
	rows: readonly Row[],
	predicates: ActivityRowPredicates<Row>,
): undefined | MediaActivityTimeline<Row> => {
	const { open, completed } = foldSegments(rows, predicates);
	const first = completed.at(0);
	const second = completed.at(1);
	if (first === undefined || second === undefined) {
		const flat = nonEmpty(rows);
		return flat === undefined ? undefined : { rows: flat, layout: "flat" };
	}
	return {
		layout: "segmented",
		open: nonEmpty(open),
		completed: [first, second, ...completed.slice(2)],
	};
};

/** Folds adjacent rows, newest first, whenever `merge` joins the current row with the next one. */
export const mergeActivityRuns = <Row>(
	rows: readonly Row[],
	merge: MediaActivityRunMerge<Row>,
): Row[] => {
	const merged: Row[] = [];
	for (const row of rows) {
		const current = merged.at(-1);
		const joined = current === undefined ? undefined : merge(current, row);
		if (joined === undefined) {
			merged.push(row);
		} else {
			merged[merged.length - 1] = joined;
		}
	}
	return merged;
};

export const mergeProgressRuns = <
	Row extends {
		readonly percent: number | undefined;
		readonly events: readonly MediaActivityEventRef[];
		readonly run?: undefined | MediaActivityProgressRun;
	},
>(
	current: Row,
	next: Row,
): Row => ({
	...current,
	events: joinEvents(current.events, next.events),
	run: {
		updates: (current.run?.updates ?? 1) + (next.run?.updates ?? 1),
		fromPercent: next.run === undefined ? next.percent : next.run.fromPercent,
	},
});

/** Folds an older progress update into the row that finished it, such as a watch or completion. */
export const absorbProgressRun = <
	Row extends {
		readonly absorbed?: number;
		readonly run?: MediaActivityProgressRun;
		readonly events: readonly MediaActivityEventRef[];
	},
>(
	current: Row,
	next: {
		readonly percent: number | undefined;
		readonly events: readonly MediaActivityEventRef[];
		readonly run?: undefined | MediaActivityProgressRun;
	},
): Row => ({
	...current,
	events: joinEvents(current.events, next.events),
	absorbed: (current.absorbed ?? 0) + next.events.length,
	run: {
		updates: (current.run?.updates ?? 0) + (next.run?.updates ?? 1),
		fromPercent: next.run === undefined ? next.percent : next.run.fromPercent,
	},
});

export const activitySpan = <Row extends ActivityAnchor>(
	rows: NonEmpty<Row>,
	truncated: boolean,
): MediaActivitySpan => {
	const [latestRow] = rows;
	const latest = latestRow.occurredAt;
	const earliest = rows.at(-1)?.occurredAt ?? latest;
	if (truncated) {
		return { latest, bound: "partial" };
	}
	return { latest, earliest, bound: "full", days: localDayCount(earliest, latest) };
};

export const mediaCollectionRowLabel = (text: MediaText, row: MediaActivityCollectionRow) =>
	row.change === "added"
		? text("timeline.collection-added", { name: row.name })
		: text("timeline.collection-removed", { name: row.name });

/** Rows newest first as a timeline and its span, or `undefined` when nothing was recorded. */
export const mediaActivityRowsView = <Row extends ActivityAnchor>(
	rows: readonly Row[],
	predicates: ActivityRowPredicates<Row>,
	truncated: boolean,
	merge?: MediaActivityRunMerge<Row>,
) => {
	const sorted = [...rows].sort(
		(left, right) =>
			right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key),
	);
	const spanned = nonEmpty(sorted);
	const timeline = mediaActivityTimeline(
		merge === undefined ? sorted : mergeActivityRuns(sorted, merge),
		predicates,
	);
	return timeline === undefined || spanned === undefined
		? undefined
		: { timeline, span: activitySpan(spanned, truncated) };
};

export const mapMediaActivity = <Result, View>(
	result: RyotQueryResult<Result>,
	view: (value: Result) => View | undefined,
): MediaActivityState<View> => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const mapped = view(state.value);
	return mapped === undefined ? { status: "empty" } : { view: mapped, status: "ready" };
};

export const mediaActivityDateLabel = (
	text: MediaText,
	formatters: Formatters,
	row: ActivityAnchor & { readonly dateUnknown?: boolean },
) =>
	row.dateUnknown === true
		? text("property.date-unknown")
		: (row.calendarDate ?? formatDateLabel(formatters, row.occurredAt));

export const mediaActivityTimeLabel = (
	formatters: Formatters,
	minutes: { readonly total: number; readonly missing: number },
) => {
	const label = formatDuration(formatters, minutes.total * 60, "minute");
	return minutes.missing > 0 ? `${label}+` : label;
};

export const mediaActivityCountFigure = (
	formatters: Formatters,
	amount: { readonly total: number; readonly missing: number },
) => `${formatters.number().format(Math.round(amount.total))}${amount.missing > 0 ? "+" : ""}`;

const spanRangeLabel = (
	text: MediaText,
	formatters: Formatters,
	earliest: string,
	latest: string,
) => {
	if (formatLocalDateKey(earliest) === formatLocalDateKey(latest)) {
		return formatDateLabel(formatters, latest);
	}
	return text("timeline.span-range", {
		end: formatDateLabel(formatters, latest),
		start:
			formatLocalYearLabel(formatters, earliest) === formatLocalYearLabel(formatters, latest)
				? formatLocalMonthDayLabel(formatters, earliest)
				: formatDateLabel(formatters, earliest),
	});
};

export const mediaActivitySpanLabel = (
	text: MediaText,
	formatters: Formatters,
	span: MediaActivitySpan,
) => {
	if (span.bound === "partial") {
		return {
			detail: undefined,
			label: text("timeline.latest"),
			value: formatDateLabel(formatters, span.latest),
		};
	}
	const { days, latest, earliest } = span;
	return {
		label: text("timeline.span"),
		value: text("timeline.span-days", { count: days }),
		detail: spanRangeLabel(text, formatters, earliest, latest),
	};
};

export const mediaActivityError = (
	text: MediaText,
	state: { readonly status: "malformed" | "transport-error" },
) => ({
	title: text("timeline.error-title"),
	detail:
		state.status === "transport-error"
			? text("timeline.error-transport")
			: text("timeline.error-malformed"),
});
