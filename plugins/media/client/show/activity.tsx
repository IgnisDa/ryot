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
	mapShowActivity,
	showActivityEpisodesLabel,
	showActivityRowLabel,
	showActivityWatchesLabel,
	type ShowActivityCoverage,
	type ShowActivityRow,
	type ShowActivitySeasonCoverage,
	type ShowActivityState,
	type ShowActivitySummary,
	type ShowActivityView,
	type ShowActivityWatchRow,
} from "./activity-state";
import { showActivityQuery } from "./queries";

const MARKER_TONE: Record<ShowActivityRow["type"], string> = {
	beat: "bg-border",
	watch: "bg-success",
	review: "bg-accent",
	progress: "bg-accent",
	completion: "bg-accent",
	collection: "bg-transparent",
};

function ShowActivityCoverageRow(props: { readonly season: ShowActivitySeasonCoverage }) {
	const { season } = props;
	return (
		<div className="flex h-4 items-center gap-3">
			<p className="w-16 font-ui text-[11.5px] text-text-muted">{season.label}</p>
			<div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-2">
				<div
					style={{ width: `${season.percent ?? 0}%` }}
					className={clsx(
						"h-full rounded-pill",
						season.watched === season.total ? "bg-success" : "bg-accent",
					)}
				/>
			</div>
			<p className="w-14 text-right font-ui text-[11.5px] text-text-subtle tabular-nums">
				{`${season.watched}/${season.total}`}
			</p>
		</div>
	);
}

function ShowActivityCoverageStrip(props: { readonly coverage: ShowActivityCoverage }) {
	const { coverage } = props;
	const rows = [
		...coverage.seasons,
		...(coverage.specials === undefined ? [] : [coverage.specials]),
	];
	if (rows.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2.5">
			<p className="font-ui font-medium text-[11px] tracking-widest text-text-subtle uppercase">
				Coverage
			</p>
			<div className="flex flex-col gap-2">
				{rows.map((season) => (
					<ShowActivityCoverageRow season={season} key={season.seasonNumber} />
				))}
			</div>
		</div>
	);
}

function ShowActivityWatchBody(props: { readonly row: ShowActivityWatchRow }) {
	if (props.row.episodes.length === 1) {
		return null;
	}
	return (
		<div className="flex flex-col gap-0.5">
			{props.row.episodes.map((episode) => (
				<div key={episode.id} className="flex gap-2">
					<p className="w-14 font-ui text-[12px] text-text-subtle">{episode.origin}</p>
					<p className="line-clamp-1 min-w-0 flex-1 font-ui text-[12px] text-text-muted">
						{episode.name}
					</p>
				</div>
			))}
		</div>
	);
}

const showActivityRender: MediaActivityRowRender<ShowActivityRow> = {
	markerTone: MARKER_TONE,
	rowLabel: showActivityRowLabel,
	rowSource: (row) => (row.type === "watch" || row.type === "progress" ? row.source : undefined),
	rowBody: (row) => {
		if (row.type === "watch") {
			return <ShowActivityWatchBody row={row} />;
		}
		if (row.type === "review") {
			return <MediaActivityReviewDetail row={row} />;
		}
		return null;
	},
};

const showActivityFigures = (summary: ShowActivitySummary) => {
	const span = mediaActivitySpanLabel(summary.span);
	return [
		{ label: "Episodes", detail: undefined, value: showActivityEpisodesLabel(summary) },
		{ label: "Watches", detail: undefined, value: showActivityWatchesLabel(summary) },
		{ label: "Time", detail: undefined, value: mediaActivityTimeLabel(summary.minutes) },
		{ label: span.label, value: span.value, detail: span.detail },
	];
};

function ShowActivityFooter(props: { readonly summary: ShowActivitySummary }) {
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

function ShowActivityEmpty() {
	return (
		<div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6">
			<p className="text-center font-ui font-medium text-base text-text">No activity yet</p>
			<p className="max-w-xl text-center font-ui text-sm text-text-muted">
				Nothing has been recorded for this show. Whatever you watch will appear here as your watch
				record.
			</p>
			<MediaLinkButton
				label="Log activity"
				onClick={() => console.log("TODO: open activity form")}
			/>
		</div>
	);
}

function ShowActivityRecord(props: { readonly compact: boolean; readonly view: ShowActivityView }) {
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
					figures={showActivityFigures(view.summary)}
				/>
				<ShowActivityCoverageStrip coverage={view.coverage} />
			</div>
			<div
				role="list"
				aria-label="Watch record"
				className={clsx("flex min-w-0 flex-col gap-5", !compact && "max-w-2xl flex-1")}
			>
				<MediaActivityTimelineView timeline={view.timeline} render={showActivityRender} />
				<ShowActivityFooter summary={view.summary} />
			</div>
		</div>
	);
}

export function ShowActivity(props: {
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly state: ShowActivityState;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return (
			<MediaStatusMessage
				title="Loading activity..."
				detail="Fetching everything you have recorded for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...mediaActivityError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "empty") {
		return <ShowActivityEmpty />;
	}
	return <ShowActivityRecord view={state.view} compact={props.compact} />;
}

export function ShowActivityTab(props: { readonly compact: boolean; readonly entityId: string }) {
	const result = useRyotQuery(showActivityQuery, { entityId: props.entityId });
	return (
		<>
			<MediaRefreshStatus result={result} />
			<ShowActivity
				compact={props.compact}
				refresh={result.refetch}
				state={mapShowActivity(result)}
			/>
		</>
	);
}
