import type { SelectedRow } from "@ryot-app/client-sdk/ryotql";

import type { mediaActivityEventSelection } from "../../shared/media-recipes";
import {
	formatLocalDateKey,
	formatLocalDateLabel,
	formatLocalMonthDayLabel,
	formatLocalYearLabel,
	localDayCount,
} from "./date";

export type NonEmpty<Value> = readonly [Value, ...Value[]];

export type ActivityAnchor = {
	readonly key: string;
	readonly dateKey: string;
	readonly occurredAt: string;
};

export type MediaActivityRowBase = ActivityAnchor & { readonly type: string };

export type MediaActivityEventRow = SelectedRow<ReturnType<typeof mediaActivityEventSelection>>;

export type MediaActivityBeatRow<Beat extends string> = ActivityAnchor & {
	readonly beat: Beat;
	readonly type: "beat";
};

export type MediaActivityCompletionRow = ActivityAnchor & {
	readonly type: "completion";
	readonly minutes: number | undefined;
	readonly startedOn: string | undefined;
	readonly completedOn: string | undefined;
};

export type MediaActivityReviewRow<Subject> = ActivityAnchor & {
	readonly type: "review";
	readonly subject: Subject;
	readonly rating: number | undefined;
	readonly body: { readonly text: string; readonly isSpoiler: boolean } | undefined;
};

export type MediaActivityCollectionRow = ActivityAnchor & {
	readonly name: string;
	readonly type: "collection";
	readonly change: "added" | "removed";
};

export type MediaActivityCompletedWatch<Row extends ActivityAnchor> = {
	readonly key: string;
	readonly rows: NonEmpty<Row>;
	readonly completion: Row;
};

export type MediaActivityTimeline<Row extends ActivityAnchor> =
	| { readonly layout: "flat"; readonly rows: NonEmpty<Row> }
	| {
			readonly layout: "segmented";
			readonly open: NonEmpty<Row> | undefined;
			readonly completed: readonly [
				MediaActivityCompletedWatch<Row>,
				MediaActivityCompletedWatch<Row>,
				...MediaActivityCompletedWatch<Row>[],
			];
	  };

export type MediaActivitySpan =
	| { readonly bound: "partial"; readonly latest: string }
	| {
			readonly days: number;
			readonly bound: "full";
			readonly latest: string;
			readonly earliest: string;
	  };

export type ActivityRowPredicates<Row extends ActivityAnchor> = {
	readonly isWatching: (row: Row) => boolean;
	readonly isCompletion: (row: Row) => boolean;
};

export const optionalText = (value: string | null) =>
	value === null || value.trim() === "" ? undefined : value;

export const nonEmpty = <Value>(values: readonly Value[]): NonEmpty<Value> | undefined => {
	const [head, ...tail] = values;
	return head === undefined ? undefined : [head, ...tail];
};

export const anchorOf = (
	event: { readonly id: string; readonly occurredAt: string },
	prefix: string,
): ActivityAnchor => ({
	key: `${prefix}-${event.id}`,
	occurredAt: event.occurredAt,
	dateKey: formatLocalDateKey(event.occurredAt),
});

export const reviewBody = (event: {
	readonly text: string | null;
	readonly isSpoiler: boolean | null;
}) => {
	const text = optionalText(event.text);
	return text === undefined ? undefined : { text, isSpoiler: event.isSpoiler === true };
};

export const mediaCompletionRow = (
	event: MediaActivityEventRow & {
		readonly startedOn: string | null;
		readonly completedOn: string | null;
	},
): MediaActivityCompletionRow => ({
	...anchorOf(event, "completion"),
	type: "completion",
	minutes: event.timeSpent ?? undefined,
	startedOn: event.startedOn ?? undefined,
	completedOn: event.completedOn ?? undefined,
});

export const mediaReviewRow = <Subject>(
	event: MediaActivityEventRow,
	subject: Subject,
): MediaActivityReviewRow<Subject> => ({
	...anchorOf(event, "review"),
	subject,
	type: "review",
	body: reviewBody(event),
	rating: event.rating ?? undefined,
});

export const mediaBeatRow = <Beat extends string>(
	event: { readonly id: string; readonly occurredAt: string },
	beat: Beat,
): MediaActivityBeatRow<Beat> => ({ ...anchorOf(event, "beat"), beat, type: "beat" });

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
	let current: { readonly completion: Row; rows: Row[] } | undefined = undefined;
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
): MediaActivityTimeline<Row> | undefined => {
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

export const decimalLabel = (value: number) => String(Math.round(value * 100) / 100);

export const mediaActivityDurationLabel = (minutes: number) => {
	const total = Math.max(Math.round(minutes), 0);
	const rest = total % 60;
	const hours = Math.floor(total / 60);
	if (hours === 0) {
		return `${rest}m`;
	}
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

const paddedUnit = (value: number) => String(value).padStart(2, "0");

export const mediaTrackLengthLabel = (seconds: number) => {
	const total = Math.max(Math.round(seconds), 0);
	const rest = total % 60;
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total / 60) % 60;
	return hours === 0
		? `${minutes}:${paddedUnit(rest)}`
		: `${hours}:${paddedUnit(minutes)}:${paddedUnit(rest)}`;
};

export const mediaActivityDateLabel = (row: ActivityAnchor) => formatLocalDateLabel(row.occurredAt);

export const mediaActivityRatingLabel = (rating: number) => `${decimalLabel(rating)} / 100`;

export const mediaActivityTimeLabel = (minutes: {
	readonly total: number;
	readonly missing: number;
}) => {
	const label = mediaActivityDurationLabel(minutes.total);
	return minutes.missing > 0 ? `${label}+` : label;
};

export const mediaActivityCountFigure = (amount: {
	readonly total: number;
	readonly missing: number;
}) => `${Math.round(amount.total)}${amount.missing > 0 ? "+" : ""}`;

const spanRangeLabel = (earliest: string, latest: string) => {
	if (formatLocalDateKey(earliest) === formatLocalDateKey(latest)) {
		return formatLocalDateLabel(latest);
	}
	return formatLocalYearLabel(earliest) === formatLocalYearLabel(latest)
		? `${formatLocalMonthDayLabel(earliest)} – ${formatLocalDateLabel(latest)}`
		: `${formatLocalDateLabel(earliest)} – ${formatLocalDateLabel(latest)}`;
};

export const mediaActivitySpanLabel = (span: MediaActivitySpan) => {
	if (span.bound === "partial") {
		return { label: "Latest", detail: undefined, value: formatLocalDateLabel(span.latest) };
	}
	const { days, latest, earliest } = span;
	return {
		label: "Span",
		detail: spanRangeLabel(earliest, latest),
		value: days === 1 ? "1 day" : `${days} days`,
	};
};

export const mediaActivityError = (state: {
	readonly status: "transport-error" | "malformed";
}) => ({
	title: "Unable to load activity",
	detail:
		state.status === "transport-error"
			? "Your recorded activity could not be loaded. Check your connection and try again."
			: "This activity came back in a form that could not be displayed. Try again later.",
});
