import type { ReactNode } from "react";

import type {
	MediaReviewActivityEvent,
	MediaReviewActivityResult,
} from "../../shared/media-recipes";
import { type MediaCopy, type MediaReviewKind, useMediaCopy } from "../messages";
import { mediaReviewActivityCopy } from "./activity-copy";
import { createMediaHistoryQuery, type MediaHistoryRecipe } from "./activity-history";
import {
	MediaActivityReviewDetail,
	type MediaActivityRowRender,
	MediaActivityRows,
} from "./activity-rows";
import { defineMediaActivityTab, MediaActivityRecord } from "./activity-tab";
import { mediaActivitySpanLabel, mediaCollectionRowLabel } from "./activity-timeline";
import type { MediaEntityRecipe } from "./detail-queries";
import { createMediaEntityQuery } from "./detail-queries";
import {
	type MediaReviewActivityRow,
	mediaReviewActivityRow,
	type MediaReviewActivityView,
	mediaReviewActivityView,
} from "./review-activity-state";
/** The activity tab of an entity whose only own events are reviews. */
export const defineMediaReviewActivityTab = (input: {
	readonly kind: MediaReviewKind;
	readonly historyRecipe: MediaHistoryRecipe<MediaReviewActivityEvent>;
	readonly activityRecipe: MediaEntityRecipe<MediaReviewActivityResult>;
}) => {
	const activityQuery = createMediaEntityQuery(input.activityRecipe, (data) =>
		data.events.flatMap((event) => (event.kind === "collection" ? [event.collection.id] : [])),
	);

	const activityRowLabel = (copy: MediaCopy, row: MediaReviewActivityRow) => {
		const activityCopy = mediaReviewActivityCopy(copy.text, input.kind);
		if (row.type === "collection") {
			return mediaCollectionRowLabel(copy.text, row);
		}
		if (row.type === "media-library") {
			return activityCopy.libraryLabel;
		}
		return activityCopy.rowLabels.review;
	};

	const activityRender = (copy: MediaCopy): MediaActivityRowRender<MediaReviewActivityRow> => ({
		segment: "activity",
		rowSource: () => undefined,
		rowLabel: (row) => activityRowLabel(copy, row),
		rowBody: (row) => (row.type === "review" ? <MediaActivityReviewDetail row={row} /> : null),
	});

	function ActivityRecord(props: {
		readonly compact: boolean;
		readonly history?: ReactNode;
		readonly view: MediaReviewActivityView;
	}) {
		const { summary, timeline } = props.view;
		const copy = useMediaCopy();
		const span = mediaActivitySpanLabel(copy.text, copy.formatters, summary.span);
		return (
			<MediaActivityRecord
				timeline={timeline}
				history={props.history}
				compact={props.compact}
				render={activityRender(copy)}
				partial={summary.span.bound === "partial"}
				recordLabel={mediaReviewActivityCopy(copy.text, input.kind).recordLabel}
				figures={[
					{
						detail: undefined,
						label: copy.text("activity.figure-reviews"),
						value: copy.formatters.number().format(summary.reviews),
					},
					{ label: span.label, value: span.value, detail: span.detail },
				]}
			/>
		);
	}

	function ReviewHistoryRows(props: {
		readonly compact: boolean;
		readonly events: readonly MediaReviewActivityEvent[];
	}) {
		const copy = useMediaCopy();
		return (
			<MediaActivityRows
				compact={props.compact}
				render={activityRender(copy)}
				rows={props.events.map(mediaReviewActivityRow)}
			/>
		);
	}

	const { Activity, ActivityTab, mapActivity } = defineMediaActivityTab({
		query: activityQuery,
		Record: ActivityRecord,
		emptyAction: "write-review",
		view: mediaReviewActivityView,
		hasMoreActivities: (result) => result.truncated,
		copy: (copy) => mediaReviewActivityCopy(copy.text, input.kind),
		renderHistory: (events, compact) => <ReviewHistoryRows events={events} compact={compact} />,
		historyQuery: createMediaHistoryQuery(input.historyRecipe, (events) =>
			events.flatMap((event) => (event.kind === "collection" ? [event.collection.id] : [])),
		),
	});

	return { Activity, ActivityTab, mapActivity, activityQuery };
};
