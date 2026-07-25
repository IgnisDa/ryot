import type {
	MediaFlatActivityCollectionEvent,
	MediaFlatActivityEvent,
	MediaFlatActivityMediaEvent,
} from "../../shared/media-recipes";
import {
	activitySpan,
	anchorOf,
	mediaActivityTimeline,
	mediaBeatRow,
	mediaCollectionRow,
	mediaCompletionRow,
	mediaReviewRow,
	nonEmpty,
	optionalText,
	type ActivityAnchor,
	type MediaActivityBeatRow,
	type MediaActivityCollectionRow,
	type MediaActivityCompletionRow,
	type MediaActivityReviewRow,
	type MediaActivitySpan,
	type MediaActivityTimeline,
} from "./activity-timeline";

export type MediaFlatActivityBeat = Exclude<
	MediaFlatActivityMediaEvent["eventSchemaSlug"],
	"review" | "complete" | "progress"
>;

type MediaFlatActivityProgressRow<Extra> = ActivityAnchor & {
	readonly type: "progress";
	readonly extra: Extra;
	readonly source: string | undefined;
	readonly percent: number | undefined;
};

export type MediaFlatActivityRow<Subject, Extra = unknown> =
	| MediaActivityCollectionRow
	| MediaActivityCompletionRow
	| MediaActivityReviewRow<Subject>
	| MediaFlatActivityProgressRow<Extra>
	| MediaActivityBeatRow<MediaFlatActivityBeat>;

export type MediaFlatActivityTimeline<Subject, Extra = unknown> = MediaActivityTimeline<
	MediaFlatActivityRow<Subject, Extra>
>;

export type MediaFlatActivitySummary = {
	readonly completions: number;
	readonly span: MediaActivitySpan;
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
			source: optionalText(event.consumedOn),
			percent: event.progressPercent ?? undefined,
		};
	}
	return mediaBeatRow(event, event.eventSchemaSlug);
};

const collectionRow = <Subject, Extra>(
	event: MediaFlatActivityCollectionEvent,
): MediaFlatActivityRow<Subject, Extra> => mediaCollectionRow(event);

const mediaFlatActivityPredicates = {
	isWatching: (row: MediaFlatActivityRow<unknown>) => row.type === "progress",
	isCompletion: (row: MediaFlatActivityRow<unknown>) => row.type === "completion",
};

export const mediaFlatActivityView = <Subject, Extra>(input: {
	readonly subject: Subject;
	readonly truncated: boolean;
	readonly completions: number;
	readonly amount: { readonly total: number; readonly missing: number };
	readonly events: readonly MediaFlatActivityEvent<Extra>[];
}): MediaFlatActivityView<Subject, Extra> | undefined => {
	const rows = input.events
		.map((event) =>
			event.kind === "media"
				? parentRow<Subject, Extra>(event, input.subject)
				: collectionRow<Subject, Extra>(event),
		)
		.sort(
			(left, right) =>
				right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key),
		);
	const spanned = nonEmpty(rows);
	const timeline = mediaActivityTimeline(rows, mediaFlatActivityPredicates);
	if (timeline === undefined || spanned === undefined) {
		return undefined;
	}
	return {
		timeline,
		summary: {
			amount: input.amount,
			completions: input.completions,
			span: activitySpan(spanned, input.truncated),
		},
	};
};
