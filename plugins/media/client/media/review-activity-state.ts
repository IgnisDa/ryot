import type { MediaReviewActivityResult } from "../../shared/media-recipes";
import {
	mediaActivityRowsView,
	mediaCollectionRow,
	mediaReviewRow,
	type MediaActivityCollectionRow,
	type MediaActivityReviewRow,
	type MediaActivitySpan,
	type MediaActivityTimeline,
} from "./activity-timeline";

type ReviewSubject = { readonly on: "entity" };

const REVIEW_SUBJECT: ReviewSubject = { on: "entity" };

export type MediaReviewActivityRow =
	| MediaActivityCollectionRow
	| MediaActivityReviewRow<ReviewSubject>;

export type MediaReviewActivityView = {
	readonly timeline: MediaActivityTimeline<MediaReviewActivityRow>;
	readonly summary: { readonly reviews: number; readonly span: MediaActivitySpan };
};

const FLAT_PREDICATES = { isWatching: () => false, isCompletion: () => false };

/** Reviews and collection changes as one flat timeline; the entity has no watches to segment. */
export const mediaReviewActivityView = (
	result: MediaReviewActivityResult,
): MediaReviewActivityView | undefined => {
	const view = mediaActivityRowsView<MediaReviewActivityRow>(
		result.events.map((event) =>
			event.kind === "media" ? mediaReviewRow(event, REVIEW_SUBJECT) : mediaCollectionRow(event),
		),
		FLAT_PREDICATES,
		result.truncated,
	);
	return view === undefined
		? undefined
		: { timeline: view.timeline, summary: { span: view.span, reviews: result.reviewCount } };
};
