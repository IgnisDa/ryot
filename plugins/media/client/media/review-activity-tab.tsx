import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";

import type { MediaReviewActivityResult } from "../../shared/media-recipes";
import { mediaReviewActivityCopy } from "./activity-copy";
import { MediaActivityReviewDetail, type MediaActivityRowRender } from "./activity-rows";
import { defineMediaActivityTab, MediaActivityRecord } from "./activity-tab";
import { mediaActivitySpanLabel, mediaCollectionRowLabel } from "./activity-timeline";
import { createMediaEntityQuery } from "./detail-queries";
import {
	mediaReviewActivityView,
	type MediaReviewActivityRow,
	type MediaReviewActivityView,
} from "./review-activity-state";

const ACTIVITY_EVENT_LIMIT = 60;
const ACTIVITY_COLLECTION_EVENT_LIMIT = 60;

const MARKER_TONE: Record<MediaReviewActivityRow["type"], string> = {
	review: "bg-accent",
	collection: "bg-transparent",
};

/** The activity tab of an entity whose only own events are reviews. */
export const defineMediaReviewActivityTab = (input: {
	readonly noun: string;
	readonly activityRecipe: (input: {
		readonly entityId: string;
		readonly eventLimit: number;
		readonly collectionEventLimit: number;
	}) => PreparedRecipe<MediaReviewActivityResult>;
}) => {
	const activityCopy = mediaReviewActivityCopy(input.noun);

	const activityQuery = createMediaEntityQuery(
		({ entityId }) =>
			input.activityRecipe({
				entityId,
				eventLimit: ACTIVITY_EVENT_LIMIT,
				collectionEventLimit: ACTIVITY_COLLECTION_EVENT_LIMIT,
			}),
		(data) =>
			data.events.flatMap((event) => (event.kind === "collection" ? [event.collection.id] : [])),
	);

	const activityRender: MediaActivityRowRender<MediaReviewActivityRow> = {
		markerTone: MARKER_TONE,
		rowSource: () => undefined,
		segmentNoun: activityCopy.segmentNoun,
		rowBody: (row) => (row.type === "review" ? <MediaActivityReviewDetail row={row} /> : null),
		rowLabel: (row) =>
			row.type === "collection" ? mediaCollectionRowLabel(row) : activityCopy.rowLabels.review,
	};

	function ActivityRecord(props: {
		readonly compact: boolean;
		readonly view: MediaReviewActivityView;
	}) {
		const { summary, timeline } = props.view;
		const span = mediaActivitySpanLabel(summary.span);
		return (
			<MediaActivityRecord
				timeline={timeline}
				render={activityRender}
				compact={props.compact}
				recordLabel={activityCopy.recordLabel}
				partial={summary.span.bound === "partial"}
				figures={[
					{ label: "Reviews", detail: undefined, value: `${summary.reviews}` },
					{ label: span.label, value: span.value, detail: span.detail },
				]}
			/>
		);
	}

	const { Activity, ActivityTab, mapActivity } = defineMediaActivityTab({
		copy: activityCopy,
		query: activityQuery,
		Record: ActivityRecord,
		emptyAction: "write-review",
		view: mediaReviewActivityView,
	});

	return { Activity, ActivityTab, mapActivity, activityQuery };
};
