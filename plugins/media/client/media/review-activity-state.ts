import type {
	MediaReviewActivityEvent,
	MediaReviewActivityResult,
} from "../../shared/media-recipes";
import {
	mediaActivityRowsView,
	mediaCollectionRow,
	mediaLibraryRow,
	mediaReviewRow,
	type MediaActivityCollectionRow,
	type MediaActivityLibraryRow,
	type MediaActivityReviewRow,
	type MediaActivitySpan,
	type MediaActivityTimeline,
} from "./activity-timeline";

type ReviewSubject = { readonly on: "entity" };

const REVIEW_SUBJECT: ReviewSubject = { on: "entity" };

export type MediaReviewActivityRow =
	| MediaActivityCollectionRow
	| MediaActivityLibraryRow
	| MediaActivityReviewRow<ReviewSubject>;

export type MediaReviewActivityView = {
	readonly timeline: MediaActivityTimeline<MediaReviewActivityRow>;
	readonly summary: { readonly reviews: number; readonly span: MediaActivitySpan };
};

const FLAT_PREDICATES = { isWatching: () => false, isCompletion: () => false };

const activityRow = (event: MediaReviewActivityEvent): MediaReviewActivityRow => {
	if (event.kind !== "media") {
		return mediaCollectionRow(event);
	}
	if (event.eventSchemaSlug === "add-to-library") {
		return mediaLibraryRow(event);
	}
	return mediaReviewRow(event, REVIEW_SUBJECT);
};

/** Reviews and collection changes as one flat timeline; the entity has no watches to segment. */
export const mediaReviewActivityView = (
	result: MediaReviewActivityResult,
): MediaReviewActivityView | undefined => {
	const view = mediaActivityRowsView<MediaReviewActivityRow>(
		result.events.map(activityRow),
		FLAT_PREDICATES,
		result.truncated,
	);
	return view === undefined
		? undefined
		: { timeline: view.timeline, summary: { span: view.span, reviews: result.reviewCount } };
};
