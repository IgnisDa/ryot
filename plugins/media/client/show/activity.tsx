import { useRyotQuery } from "@ryot-app/client-sdk/react";
import clsx from "clsx";

import { MediaActivityReviewDetail, type MediaActivityRowRender } from "../media/activity-rows";
import { MediaActivity, MediaActivityRecord, type MediaActivityCopy } from "../media/activity-tab";
import { mediaActivitySpanLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import { MediaRefreshStatus } from "../media/primitives";
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

const SHOW_ACTIVITY_COPY: MediaActivityCopy = {
	recordLabel: "Watch record",
	loadingDetail: "Fetching everything you have recorded for this show.",
	emptyDetail:
		"Nothing has been recorded for this show. Whatever you watch will appear here as your watch record.",
};

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

function ShowActivityRecord(props: { readonly compact: boolean; readonly view: ShowActivityView }) {
	const { view } = props;
	return (
		<MediaActivityRecord
			compact={props.compact}
			timeline={view.timeline}
			render={showActivityRender}
			figures={showActivityFigures(view.summary)}
			recordLabel={SHOW_ACTIVITY_COPY.recordLabel}
			partial={view.summary.span.bound === "partial"}
			aside={<ShowActivityCoverageStrip coverage={view.coverage} />}
		/>
	);
}

export function ShowActivity(props: {
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly state: ShowActivityState;
}) {
	return (
		<MediaActivity
			state={props.state}
			compact={props.compact}
			refresh={props.refresh}
			copy={SHOW_ACTIVITY_COPY}
			Record={ShowActivityRecord}
		/>
	);
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
