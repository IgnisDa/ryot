import type {
	MediaFlatActivityEvent,
	MediaFlatActivityMediaEvent,
} from "../../shared/media-recipes";
import {
	type ActivityAnchor,
	anchorOf,
	type MediaActivityBeatRow,
	type MediaActivityCollectionRow,
	type MediaActivityCompletionRow,
	type MediaActivityLibraryRow,
	type MediaActivityReviewRow,
	mediaActivityRowsView,
	type MediaActivitySpan,
	type MediaActivityTimeline,
	mediaBeatRow,
	mediaCollectionRow,
	mediaCompletionRow,
	mediaLibraryRow,
	mediaReviewRow,
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

export const mediaFlatActivityView = <Subject, Extra>(input: {
	readonly subject: Subject;
	readonly truncated: boolean;
	readonly completions: number;
	readonly amount: { readonly total: number; readonly missing: number };
	readonly events: readonly MediaFlatActivityEvent<Extra>[];
}): MediaFlatActivityView<Subject, Extra> | undefined => {
	const view = mediaActivityRowsView(
		input.events.map((event) => mediaFlatActivityRow(event, input.subject)),
		mediaFlatActivityPredicates,
		input.truncated,
	);
	if (view === undefined) {
		return undefined;
	}
	return {
		timeline: view.timeline,
		summary: { span: view.span, amount: input.amount, completions: input.completions },
	};
};
