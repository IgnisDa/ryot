import type { PluginIdentityReference } from "@ryot-app/plugin-client-sdk/plugin";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";
import type { ReactNode } from "react";

import type {
	MediaReviewActivityEvent,
	MediaReviewActivityResult,
} from "../../shared/media-recipes";
import { mediaReviewActivityCopy } from "./activity-copy";
import { createMediaHistoryQuery, type MediaHistoryRecipe } from "./activity-history";
import {
	MediaActivityReviewDetail,
	type MediaActivityRowRender,
	MediaActivityRows,
} from "./activity-rows";
import { defineMediaActivityTab, MediaActivityRecord } from "./activity-tab";
import { mediaActivitySpanLabel, mediaCollectionRowLabel } from "./activity-timeline";
import { createMediaEntityQuery } from "./detail-queries";
import {
	type MediaReviewActivityRow,
	mediaReviewActivityRow,
	type MediaReviewActivityView,
	mediaReviewActivityView,
} from "./review-activity-state";

const ACTIVITY_EVENT_LIMIT = 60;
const ACTIVITY_COLLECTION_EVENT_LIMIT = 60;

/** The activity tab of an entity whose only own events are reviews. */
export const defineMediaReviewActivityTab = (input: {
	readonly noun: string;
	readonly historyRecipe: MediaHistoryRecipe<MediaReviewActivityEvent>;
	readonly activityRecipe: (input: {
		readonly reference: PluginIdentityReference;
		readonly entityId: string;
		readonly eventLimit: number;
		readonly collectionEventLimit: number;
	}) => PreparedRecipe<MediaReviewActivityResult>;
}) => {
	const activityCopy = mediaReviewActivityCopy(input.noun);

	const activityQuery = createMediaEntityQuery(
		({ entityId, reference }) =>
			input.activityRecipe({
				entityId,
				reference,
				eventLimit: ACTIVITY_EVENT_LIMIT,
				collectionEventLimit: ACTIVITY_COLLECTION_EVENT_LIMIT,
			}),
		(data) =>
			data.events.flatMap((event) => (event.kind === "collection" ? [event.collection.id] : [])),
	);

	const activityRowLabel = (row: MediaReviewActivityRow) => {
		if (row.type === "collection") {
			return mediaCollectionRowLabel(row);
		}
		if (row.type === "media-library") {
			return activityCopy.libraryLabel;
		}
		return activityCopy.rowLabels.review;
	};

	const activityRender: MediaActivityRowRender<MediaReviewActivityRow> = {
		rowSource: () => undefined,
		rowLabel: activityRowLabel,
		segmentNoun: activityCopy.segmentNoun,
		rowBody: (row) => (row.type === "review" ? <MediaActivityReviewDetail row={row} /> : null),
	};

	function ActivityRecord(props: {
		readonly compact: boolean;
		readonly view: MediaReviewActivityView;
		readonly history?: ReactNode;
	}) {
		const { summary, timeline } = props.view;
		const span = mediaActivitySpanLabel(summary.span);
		return (
			<MediaActivityRecord
				timeline={timeline}
				history={props.history}
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
		hasMoreActivities: (result) => result.truncated,
		historyQuery: createMediaHistoryQuery(input.historyRecipe, (events) =>
			events.flatMap((event) => (event.kind === "collection" ? [event.collection.id] : [])),
		),
		renderHistory: (events, compact) => (
			<MediaActivityRows
				compact={compact}
				render={activityRender}
				rows={events.map(mediaReviewActivityRow)}
			/>
		),
	});

	return { Activity, ActivityTab, mapActivity, activityQuery };
};
