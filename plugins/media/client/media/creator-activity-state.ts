import type { MediaCreatorActivityResult } from "../../shared/creator-recipes";
import {
	mediaActivityRowsView,
	mediaCollectionRow,
	mediaReviewRow,
	type MediaActivityCollectionRow,
	type MediaActivityReviewRow,
	type MediaActivitySpan,
	type MediaActivityTimeline,
} from "./activity-timeline";

type CreatorReviewSubject = { readonly on: "creator" };

const REVIEW_SUBJECT: CreatorReviewSubject = { on: "creator" };

export type MediaCreatorActivityRow =
	| MediaActivityCollectionRow
	| MediaActivityReviewRow<CreatorReviewSubject>;

export type MediaCreatorActivityView = {
	readonly timeline: MediaActivityTimeline<MediaCreatorActivityRow>;
	readonly summary: { readonly reviews: number; readonly span: MediaActivitySpan };
};

const FLAT_PREDICATES = { isWatching: () => false, isCompletion: () => false };

/** Reviews and collection changes as one flat timeline; creators have no watches to segment. */
export const mediaCreatorActivityView = (
	result: MediaCreatorActivityResult,
): MediaCreatorActivityView | undefined => {
	const view = mediaActivityRowsView<MediaCreatorActivityRow>(
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
