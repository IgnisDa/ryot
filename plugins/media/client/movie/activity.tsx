import { useRyotQuery } from "@ryot-app/client-sdk/react";

import { MediaActivityReviewDetail, type MediaActivityRowRender } from "../media/activity-rows";
import { MediaActivity, MediaActivityRecord, type MediaActivityCopy } from "../media/activity-tab";
import { mediaActivitySpanLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import { MediaRefreshStatus } from "../media/primitives";
import {
	mapMovieActivity,
	movieActivityRowLabel,
	movieActivityWatchesLabel,
	type MovieActivityRow,
	type MovieActivityState,
	type MovieActivitySummary,
	type MovieActivityView,
} from "./activity-state";
import { movieActivityQuery } from "./queries";

const MARKER_TONE: Record<MovieActivityRow["type"], string> = {
	beat: "bg-border",
	review: "bg-accent",
	progress: "bg-accent",
	completion: "bg-accent",
	collection: "bg-transparent",
};

const MOVIE_ACTIVITY_COPY: MediaActivityCopy = {
	recordLabel: "Watch record",
	loadingDetail: "Fetching everything you have recorded for this movie.",
	emptyDetail:
		"Nothing has been recorded for this movie. Whatever you watch will appear here as your watch record.",
};

const movieActivityRender: MediaActivityRowRender<MovieActivityRow> = {
	markerTone: MARKER_TONE,
	rowLabel: movieActivityRowLabel,
	rowSource: (row) => (row.type === "progress" ? row.source : undefined),
	rowBody: (row) => (row.type === "review" ? <MediaActivityReviewDetail row={row} /> : null),
};

const movieActivityFigures = (summary: MovieActivitySummary) => {
	const span = mediaActivitySpanLabel(summary.span);
	return [
		{ label: "Watches", detail: undefined, value: movieActivityWatchesLabel(summary) },
		{ label: "Time", detail: undefined, value: mediaActivityTimeLabel(summary.minutes) },
		{ label: span.label, value: span.value, detail: span.detail },
	];
};

function MovieActivityRecord(props: {
	readonly compact: boolean;
	readonly view: MovieActivityView;
}) {
	const { view } = props;
	return (
		<MediaActivityRecord
			compact={props.compact}
			timeline={view.timeline}
			render={movieActivityRender}
			figures={movieActivityFigures(view.summary)}
			recordLabel={MOVIE_ACTIVITY_COPY.recordLabel}
			partial={view.summary.span.bound === "partial"}
		/>
	);
}

export function MovieActivity(props: {
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly state: MovieActivityState;
}) {
	return (
		<MediaActivity
			state={props.state}
			compact={props.compact}
			refresh={props.refresh}
			copy={MOVIE_ACTIVITY_COPY}
			Record={MovieActivityRecord}
		/>
	);
}

export function MovieActivityTab(props: { readonly compact: boolean; readonly entityId: string }) {
	const result = useRyotQuery(movieActivityQuery, { entityId: props.entityId });
	return (
		<>
			<MediaRefreshStatus result={result} />
			<MovieActivity
				compact={props.compact}
				refresh={result.refetch}
				state={mapMovieActivity(result)}
			/>
		</>
	);
}
