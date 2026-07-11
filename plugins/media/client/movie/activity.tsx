import { useRyotQuery } from "@ryot-app/client-sdk/react";
import clsx from "clsx";

import {
	MediaActivityReviewDetail,
	MediaActivitySummaryFigures,
	MediaActivityTimelineView,
	type MediaActivityRowRender,
} from "../media/activity-rows";
import {
	mediaActivityError,
	mediaActivitySpanLabel,
	mediaActivityTimeLabel,
} from "../media/activity-timeline";
import { MediaLinkButton, MediaRefreshStatus, MediaStatusMessage } from "../media/primitives";
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

function MovieActivityFooter(props: { readonly summary: MovieActivitySummary }) {
	return (
		<div className="flex flex-col items-start gap-2 border-t border-border pt-4">
			{props.summary.span.bound === "partial" ? (
				<p className="font-ui text-[12px] text-text-subtle">
					Only your most recent activity is shown here.
				</p>
			) : null}
			<MediaLinkButton
				label="View complete history"
				onClick={() => console.log("TODO: open complete activity history")}
			/>
		</div>
	);
}

function MovieActivityEmpty() {
	return (
		<div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6">
			<p className="text-center font-ui font-medium text-base text-text">No activity yet</p>
			<p className="max-w-xl text-center font-ui text-sm text-text-muted">
				Nothing has been recorded for this movie. Whatever you watch will appear here as your watch
				record.
			</p>
			<MediaLinkButton
				label="Log activity"
				onClick={() => console.log("TODO: open activity form")}
			/>
		</div>
	);
}

function MovieActivityRecord(props: {
	readonly compact: boolean;
	readonly view: MovieActivityView;
}) {
	const { view, compact } = props;
	return (
		<div
			className={clsx(
				"flex gap-6",
				compact ? "flex-col pt-6" : "flex-row justify-center gap-10 pt-8",
			)}
		>
			<div className={clsx("flex flex-col gap-5", !compact && "w-72 shrink-0")}>
				<MediaActivitySummaryFigures
					compact={compact}
					figures={movieActivityFigures(view.summary)}
				/>
			</div>
			<div
				role="list"
				aria-label="Watch record"
				className={clsx("flex min-w-0 flex-col gap-5", !compact && "max-w-2xl flex-1")}
			>
				<MediaActivityTimelineView timeline={view.timeline} render={movieActivityRender} />
				<MovieActivityFooter summary={view.summary} />
			</div>
		</div>
	);
}

export function MovieActivity(props: {
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly state: MovieActivityState;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return (
			<MediaStatusMessage
				title="Loading activity..."
				detail="Fetching everything you have recorded for this movie."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...mediaActivityError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "empty") {
		return <MovieActivityEmpty />;
	}
	return <MovieActivityRecord view={state.view} compact={props.compact} />;
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
