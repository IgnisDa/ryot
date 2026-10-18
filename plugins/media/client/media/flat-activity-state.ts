import type {
	MediaFlatActivityEvent,
	MediaFlatActivityMediaEvent,
} from "../../shared/media-recipes";
import {
	absorbProgressRun,
	type ActivityAnchor,
	anchorOf,
	decimalLabel,
	eventRef,
	type MediaActivityBeatRow,
	type MediaActivityCollectionRow,
	type MediaActivityCompletionRow,
	type MediaActivityEventRef,
	type MediaActivityFigure,
	type MediaActivityLibraryRow,
	type MediaActivityProgressRun,
	type MediaActivityReviewRow,
	mediaActivityRowsView,
	type MediaActivityRunMerge,
	type MediaActivitySpan,
	mediaActivitySpanLabel,
	type MediaActivityTimeline,
	mediaBeatRow,
	mediaCollectionRow,
	mediaCompletionRow,
	mediaLibraryRow,
	mediaReviewRow,
	mergeProgressRuns,
	optionalText,
} from "./activity-timeline";

export type MediaFlatActivityBeat = Exclude<
	MediaFlatActivityMediaEvent["eventSchemaSlug"],
	"review" | "complete" | "progress" | "add-to-media-library" | "list-state"
>;

type MediaFlatActivityProgressRow<Extra> = ActivityAnchor & {
	readonly type: "progress";
	readonly extra: Extra;
	readonly source: string | undefined;
	readonly percent: number | undefined;
	readonly run?: MediaActivityProgressRun;
	readonly events: readonly MediaActivityEventRef[];
};

type MediaFlatActivitySnapshotRow<Extra> = ActivityAnchor & {
	readonly type: "snapshot";
	readonly extra: Extra;
};

export type MediaFlatActivityRow<Subject, Extra = unknown> =
	| MediaActivityCollectionRow
	| MediaActivityCompletionRow
	| MediaActivityLibraryRow
	| MediaActivityReviewRow<Subject>
	| MediaFlatActivityProgressRow<Extra>
	| MediaFlatActivitySnapshotRow<Extra>
	| MediaActivityBeatRow<MediaFlatActivityBeat>;

export type MediaFlatActivityTimeline<Subject, Extra = unknown> = MediaActivityTimeline<
	MediaFlatActivityRow<Subject, Extra>
>;

export type MediaFlatActivitySummary = {
	readonly completions: number;
	readonly span: MediaActivitySpan;
	readonly progress: number | undefined;
	readonly amount: { readonly total: number; readonly missing: number };
};

export type MediaFlatActivityView<Subject, Extra = unknown> = {
	readonly summary: MediaFlatActivitySummary;
	readonly timeline: MediaFlatActivityTimeline<Subject, Extra>;
};

const parentRow = <Subject, Extra>(
	event: MediaFlatActivityMediaEvent<Extra>,
	subject: Subject,
): MediaFlatActivityRow<Subject, Extra> => {
	if (event.eventSchemaSlug === "add-to-media-library") {
		return mediaLibraryRow(event);
	}
	if (event.eventSchemaSlug === "complete") {
		return mediaCompletionRow(event);
	}
	if (event.eventSchemaSlug === "review") {
		return mediaReviewRow(event, subject);
	}
	if (event.eventSchemaSlug === "progress") {
		return {
			...anchorOf(event, "progress"),
			extra: event,
			type: "progress",
			events: [eventRef(event)],
			source: optionalText(event.consumedOn),
			percent: event.progressPercent ?? undefined,
		};
	}
	if (event.eventSchemaSlug === "list-state") {
		return { ...anchorOf(event, "snapshot"), extra: event, type: "snapshot" };
	}
	return mediaBeatRow(event, event.eventSchemaSlug);
};

export const mediaFlatActivityRow = <Subject, Extra>(
	event: MediaFlatActivityEvent<Extra>,
	subject: Subject,
) =>
	event.kind === "media" ? parentRow<Subject, Extra>(event, subject) : mediaCollectionRow(event);

const mediaFlatActivityPredicates = {
	isWatching: (row: MediaFlatActivityRow<unknown>) => row.type === "progress",
	isCompletion: (row: MediaFlatActivityRow<unknown>) => row.type === "completion",
};

const latestProgressPercent = (rows: readonly MediaFlatActivityRow<unknown>[]) => {
	const [latest] = rows
		.flatMap((row) => (row.type === "progress" ? [row] : []))
		.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
	return latest?.percent;
};

export const mergeFlatRuns =
	<Subject, Extra>(sameTarget: (current: Extra, next: Extra) => boolean) =>
	(
		current: MediaFlatActivityRow<Subject, Extra>,
		next: MediaFlatActivityRow<Subject, Extra>,
	): MediaFlatActivityRow<Subject, Extra> | undefined => {
		if (current.type === "progress" && next.type === "progress") {
			return sameTarget(current.extra, next.extra) ? mergeProgressRuns(current, next) : undefined;
		}
		return current.type === "completion" &&
			next.type === "progress" &&
			current.dateKey === next.dateKey
			? absorbProgressRun(current, next)
			: undefined;
	};

export const mediaFlatActivityView = <Subject, Extra>(input: {
	readonly subject: Subject;
	readonly truncated: boolean;
	readonly completions: number;
	readonly merge: MediaActivityRunMerge<MediaFlatActivityRow<Subject, Extra>>;
	readonly amount: { readonly total: number; readonly missing: number };
	readonly events: readonly MediaFlatActivityEvent<Extra>[];
}): MediaFlatActivityView<Subject, Extra> | undefined => {
	const rows = input.events.map((event) => mediaFlatActivityRow(event, input.subject));
	const view = mediaActivityRowsView(
		rows,
		mediaFlatActivityPredicates,
		input.truncated,
		input.merge,
	);
	if (view === undefined) {
		return undefined;
	}
	return {
		timeline: view.timeline,
		summary: {
			span: view.span,
			amount: input.amount,
			completions: input.completions,
			progress: latestProgressPercent(rows),
		},
	};
};

export const mediaFlatActivityFigures = (
	summary: MediaFlatActivitySummary,
	labels: {
		readonly completions: string;
		readonly measure: {
			readonly label: string;
			readonly value: (amount: MediaFlatActivitySummary["amount"]) => string;
		};
	},
): readonly MediaActivityFigure[] => {
	const span = mediaActivitySpanLabel(summary.span);
	const leading =
		summary.completions === 0 && summary.progress !== undefined
			? { label: "Progress", value: `${decimalLabel(summary.progress)}%` }
			: { label: labels.completions, value: `${summary.completions}` };
	const hasAmount = summary.amount.total !== 0 || summary.amount.missing !== 0;
	return [
		{ ...leading, detail: undefined },
		...(hasAmount
			? [
					{
						detail: undefined,
						label: labels.measure.label,
						value: labels.measure.value(summary.amount),
					},
				]
			: []),
		{ label: span.label, value: span.value, detail: span.detail },
	];
};
