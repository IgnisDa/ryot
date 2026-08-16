import { useRyotQuery } from "@ryot-app/client-sdk/react";

import { MediaActivityReviewDetail, type MediaActivityRowRender } from "../media/activity-rows";
import { MediaActivity, MediaActivityRecord, type MediaActivityCopy } from "../media/activity-tab";
import { mediaActivitySpanLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import { MediaRefreshStatus } from "../media/primitives";
import {
	mapMusicActivity,
	musicActivityListensLabel,
	musicActivityRowLabel,
	type MusicActivityRow,
	type MusicActivityState,
	type MusicActivitySummary,
	type MusicActivityView,
} from "./activity-state";
import { musicActivityQuery } from "./queries";

const MARKER_TONE: Record<MusicActivityRow["type"], string> = {
	beat: "bg-border",
	review: "bg-accent",
	progress: "bg-accent",
	completion: "bg-accent",
	collection: "bg-transparent",
};

const MUSIC_ACTIVITY_COPY: MediaActivityCopy = {
	recordLabel: "Listen record",
	loadingDetail: "Fetching everything you have recorded for this track.",
	emptyDetail:
		"Nothing has been recorded for this track. Whatever you listen to will appear here as your listen record.",
};

const musicActivityRender: MediaActivityRowRender<MusicActivityRow> = {
	segmentNoun: "Listen",
	markerTone: MARKER_TONE,
	rowLabel: musicActivityRowLabel,
	rowSource: (row) => (row.type === "progress" ? row.source : undefined),
	rowBody: (row) => (row.type === "review" ? <MediaActivityReviewDetail row={row} /> : null),
};

const musicActivityFigures = (summary: MusicActivitySummary) => {
	const span = mediaActivitySpanLabel(summary.span);
	return [
		{ label: "Listens", detail: undefined, value: musicActivityListensLabel(summary) },
		{ label: "Time", detail: undefined, value: mediaActivityTimeLabel(summary.minutes) },
		{ label: span.label, value: span.value, detail: span.detail },
	];
};

function MusicActivityRecord(props: {
	readonly compact: boolean;
	readonly view: MusicActivityView;
}) {
	const { view } = props;
	return (
		<MediaActivityRecord
			compact={props.compact}
			timeline={view.timeline}
			render={musicActivityRender}
			figures={musicActivityFigures(view.summary)}
			recordLabel={MUSIC_ACTIVITY_COPY.recordLabel}
			partial={view.summary.span.bound === "partial"}
		/>
	);
}

export function MusicActivity(props: {
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly state: MusicActivityState;
}) {
	return (
		<MediaActivity
			state={props.state}
			compact={props.compact}
			refresh={props.refresh}
			copy={MUSIC_ACTIVITY_COPY}
			Record={MusicActivityRecord}
		/>
	);
}

export function MusicActivityTab(props: { readonly compact: boolean; readonly entityId: string }) {
	const result = useRyotQuery(musicActivityQuery, { entityId: props.entityId });
	return (
		<>
			<MediaRefreshStatus result={result} />
			<MusicActivity
				compact={props.compact}
				refresh={result.refetch}
				state={mapMusicActivity(result)}
			/>
		</>
	);
}
