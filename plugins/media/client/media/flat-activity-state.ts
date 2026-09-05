import type { MediaFlatActivityEvent } from "../../shared/media-recipes";
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

type FlatParentEvent = Extract<MediaFlatActivityEvent, { kind: "media" }>;

type FlatCollectionEvent = Extract<MediaFlatActivityEvent, { kind: "collection" }>;

export type MediaFlatActivityBeat = Exclude<
	FlatParentEvent["eventSchemaSlug"],
	"review" | "complete" | "progress"
>;

type MediaFlatActivityProgressRow = ActivityAnchor & {
	readonly type: "progress";
	readonly source: string | undefined;
	readonly percent: number | undefined;
};

export type MediaFlatActivityRow<Subject> =
	| MediaActivityCollectionRow
	| MediaActivityCompletionRow
	| MediaFlatActivityProgressRow
	| MediaActivityReviewRow<Subject>
	| MediaActivityBeatRow<MediaFlatActivityBeat>;

export type MediaFlatActivityTimeline<Subject> = MediaActivityTimeline<
	MediaFlatActivityRow<Subject>
>;

export type MediaFlatActivitySummary = {
	readonly completions: number;
	readonly span: MediaActivitySpan;
	readonly amount: { readonly total: number; readonly missing: number };
};

export type MediaFlatActivityView<Subject> = {
	readonly summary: MediaFlatActivitySummary;
	readonly timeline: MediaFlatActivityTimeline<Subject>;
};

const parentRow = <Subject>(
	event: FlatParentEvent,
	subject: Subject,
): MediaFlatActivityRow<Subject> => {
	if (event.eventSchemaSlug === "complete") {
		return mediaCompletionRow(event);
	}
	if (event.eventSchemaSlug === "review") {
		return mediaReviewRow(event, subject);
	}
	if (event.eventSchemaSlug === "progress") {
		return {
			...anchorOf(event, "progress"),
			type: "progress",
			source: optionalText(event.consumedOn),
			percent: event.progressPercent ?? undefined,
		};
	}
	return mediaBeatRow(event, event.eventSchemaSlug);
};

const collectionRow = <Subject>(event: FlatCollectionEvent): MediaFlatActivityRow<Subject> =>
	mediaCollectionRow(event);

const mediaFlatActivityPredicates = {
	isWatching: (row: MediaFlatActivityRow<unknown>) => row.type === "progress",
	isCompletion: (row: MediaFlatActivityRow<unknown>) => row.type === "completion",
};

export const mediaFlatActivityView = <Subject>(input: {
	readonly subject: Subject;
	readonly truncated: boolean;
	readonly completions: number;
	readonly amount: { readonly total: number; readonly missing: number };
	readonly events: readonly MediaFlatActivityEvent[];
}): MediaFlatActivityView<Subject> | undefined => {
	const rows = input.events
		.map((event) =>
			event.kind === "media" ? parentRow(event, input.subject) : collectionRow<Subject>(event),
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
