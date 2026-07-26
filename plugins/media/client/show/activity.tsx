import { useRyotQuery } from "@ryot-app/client-sdk/react";
import clsx from "clsx";
import { useState } from "react";

import {
	mapShowActivity,
	showActivityDateLabel,
	showActivityEpisodesLabel,
	showActivityError,
	showActivityRatingLabel,
	showActivityRowLabel,
	showActivitySpanLabel,
	showActivityTimeLabel,
	showActivityWatchesLabel,
	type ShowActivityCollectionRow,
	type ShowActivityCompletedWatch,
	type ShowActivityCoverage,
	type ShowActivityReviewRow,
	type ShowActivityRow,
	type ShowActivitySeasonCoverage,
	type ShowActivityState,
	type ShowActivitySummary,
	type ShowActivityTimeline,
	type ShowActivityView,
	type ShowActivityWatchRow,
} from "./activity-state";
import { ShowFact, ShowLinkButton, ShowRefreshStatus, ShowStatusMessage } from "./primitives";
import { showActivityQuery } from "./queries";

const MARKER_TONE: Record<ShowActivityRow["type"], string> = {
	watch: "bg-success",
	review: "bg-accent",
	progress: "bg-accent",
	completion: "bg-accent",
	beat: "bg-border",
	collection: "bg-transparent",
};

function ShowActivitySummaryFigures(props: {
	readonly compact: boolean;
	readonly summary: ShowActivitySummary;
}) {
	const { summary } = props;
	const span = showActivitySpanLabel(summary);
	const figures = [
		{ label: "Episodes", value: showActivityEpisodesLabel(summary), detail: undefined },
		{ label: "Watches", value: showActivityWatchesLabel(summary), detail: undefined },
		{ label: "Time", value: showActivityTimeLabel(summary), detail: undefined },
		{ label: span.label, value: span.value, detail: span.detail },
	];
	return (
		<div className="flex flex-wrap gap-y-4 rounded-lg border border-border bg-surface px-3.5 py-3">
			{figures.map((figure) => (
				<div
					key={figure.label}
					className={clsx("flex flex-col gap-0.5", props.compact ? "w-1/2" : "w-1/4")}
				>
					<ShowFact label={figure.label} value={figure.value} />
					{figure.detail === undefined ? null : (
						<p className="font-ui text-[11px] text-text-subtle">{figure.detail}</p>
					)}
				</div>
			))}
		</div>
	);
}

function ShowActivityCoverageRow(props: { readonly season: ShowActivitySeasonCoverage }) {
	const { season } = props;
	return (
		<div className="flex h-4 items-center gap-3">
			<p className="w-16 font-ui text-[11.5px] text-text-muted">{season.label}</p>
			<div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-2">
				<div
					className={clsx(
						"h-full rounded-pill",
						season.watched === season.total ? "bg-success" : "bg-accent",
					)}
					style={{ width: `${season.percent ?? 0}%` }}
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
					<ShowActivityCoverageRow key={season.seasonNumber} season={season} />
				))}
			</div>
		</div>
	);
}

function ShowActivityMarker(props: { readonly row: ShowActivityRow }) {
	const isBeat = props.row.type === "completion";
	return (
		<div
			className={clsx(
				"rounded-pill",
				MARKER_TONE[props.row.type],
				isBeat && "h-3 w-3 border-2 border-accent bg-transparent",
				!isBeat && "h-2 w-2",
				props.row.type === "collection" && "border border-border",
			)}
		/>
	);
}

function ShowActivityReviewBody(props: { readonly text: string; readonly isSpoiler: boolean }) {
	const [isRevealed, setIsRevealed] = useState(false);
	if (props.isSpoiler && !isRevealed) {
		return (
			<button
				type="button"
				aria-label="Show spoiler review"
				onClick={() => setIsRevealed(true)}
				className="self-start rounded-md border border-border bg-surface-2 px-2.5 py-1.5"
			>
				<span className="font-ui text-[12px] text-text-muted">Spoiler — show review</span>
			</button>
		);
	}
	return <p className="font-ui text-[13px] leading-5 text-text-muted">{props.text}</p>;
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

function ShowActivityReviewDetail(props: { readonly row: ShowActivityReviewRow }) {
	const { row } = props;
	return (
		<div className="flex flex-col gap-1 border-l-2 border-accent-border pl-2.5">
			{row.rating === undefined ? null : (
				<p className="font-ui font-medium text-[11px] text-accent-text">
					{showActivityRatingLabel(row.rating)}
				</p>
			)}
			{row.body === undefined ? null : (
				<ShowActivityReviewBody text={row.body.text} isSpoiler={row.body.isSpoiler} />
			)}
		</div>
	);
}

function ShowActivityRowBody(props: { readonly row: ShowActivityRow }) {
	if (props.row.type === "watch") {
		return <ShowActivityWatchBody row={props.row} />;
	}
	if (props.row.type === "review") {
		return <ShowActivityReviewDetail row={props.row} />;
	}
	return null;
}

const rowSource = (row: ShowActivityRow) =>
	row.type === "watch" || row.type === "progress" ? row.source : undefined;

const isQuietRow = (row: ShowActivityRow): row is ShowActivityCollectionRow =>
	row.type === "collection";

function ShowActivityEntry(props: {
	readonly isLast: boolean;
	readonly row: ShowActivityRow;
	readonly showDate: boolean;
}) {
	const { row } = props;
	const source = rowSource(row);
	const isHeading = row.type === "completion" || row.type === "beat";
	return (
		<div className="flex">
			<div className="w-16 pt-1.5">
				{props.showDate ? (
					<p className="font-ui text-[11px] text-text-subtle">{showActivityDateLabel(row)}</p>
				) : null}
			</div>
			<div className="flex w-3.5 flex-col items-center pt-2">
				<ShowActivityMarker row={row} />
				{props.isLast ? null : <div className="w-px flex-1 bg-border" />}
			</div>
			<div className={clsx("flex min-w-0 flex-1 flex-col gap-1.5 pl-3", !props.isLast && "pb-4")}>
				<div className="flex items-baseline justify-between gap-2.5">
					<p
						className={clsx(
							"min-w-0 flex-1",
							isHeading && "font-display font-semibold text-[15px] text-text",
							!isHeading &&
								(isQuietRow(row)
									? "font-ui text-[13px] text-text-muted"
									: "font-ui font-medium text-[13.5px] text-text"),
						)}
					>
						{showActivityRowLabel(row)}
					</p>
					{source === undefined ? null : (
						<span className="rounded-pill border border-border px-1.5 font-ui text-[10.5px] text-text-subtle">
							{source}
						</span>
					)}
				</div>
				<ShowActivityRowBody row={row} />
			</div>
		</div>
	);
}

function ShowActivityRows(props: { readonly rows: readonly ShowActivityRow[] }) {
	return (
		<div>
			{props.rows.map((row, index) => (
				<ShowActivityEntry
					row={row}
					key={row.key}
					isLast={index === props.rows.length - 1}
					showDate={props.rows[index - 1]?.dateKey !== row.dateKey}
				/>
			))}
		</div>
	);
}

function ShowActivityWatchSeparator(props: { readonly label: string }) {
	return (
		<div className="flex items-center gap-2.5 pb-3.5">
			<p className="font-ui font-medium text-[11px] tracking-widest text-text-subtle uppercase">
				{props.label}
			</p>
			<div className="h-px flex-1 bg-border" />
		</div>
	);
}

const watchSeparatorLabel = (watch: ShowActivityCompletedWatch, index: number, total: number) =>
	`Watch ${total - index} · ${showActivityDateLabel(watch.completion)}`;

function ShowActivityTimelineView(props: { readonly timeline: ShowActivityTimeline }) {
	if (props.timeline.layout === "flat") {
		return <ShowActivityRows rows={props.timeline.rows} />;
	}
	const { open, completed } = props.timeline;
	return (
		<div className="flex flex-col gap-5">
			{open === undefined ? null : (
				<div>
					<ShowActivityWatchSeparator label="Since the last watch" />
					<ShowActivityRows rows={open} />
				</div>
			)}
			{completed.map((watch, index) => (
				<div key={watch.key}>
					<ShowActivityWatchSeparator label={watchSeparatorLabel(watch, index, completed.length)} />
					<ShowActivityRows rows={watch.rows} />
				</div>
			))}
		</div>
	);
}

function ShowActivityFooter(props: { readonly summary: ShowActivitySummary }) {
	return (
		<div className="flex flex-col items-start gap-2 border-t border-border pt-4">
			{props.summary.span.bound === "partial" ? (
				<p className="font-ui text-[12px] text-text-subtle">
					Only your most recent activity is shown here.
				</p>
			) : null}
			<ShowLinkButton
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
			<ShowLinkButton
				label="Log activity"
				onClick={() => console.log("TODO: open activity form")}
			/>
		</div>
	);
}

function ShowActivityRecord(props: { readonly compact: boolean; readonly view: ShowActivityView }) {
	const { compact, view } = props;
	return (
		<div
			className={clsx(
				"flex gap-6",
				compact ? "flex-col pt-6" : "flex-row justify-center gap-10 pt-8",
			)}
		>
			<div className={clsx("flex flex-col gap-5", !compact && "w-72 shrink-0")}>
				<ShowActivitySummaryFigures compact={compact} summary={view.summary} />
				<ShowActivityCoverageStrip coverage={view.coverage} />
			</div>
			<div
				role="list"
				aria-label="Watch record"
				className={clsx("flex min-w-0 flex-col gap-5", !compact && "max-w-2xl flex-1")}
			>
				<ShowActivityTimelineView timeline={view.timeline} />
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
			<ShowStatusMessage
				title="Loading activity..."
				detail="Fetching everything you have recorded for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <ShowStatusMessage {...showActivityError(state)} onRetry={props.refresh} />;
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
			<ShowRefreshStatus result={result} />
			<ShowActivity
				compact={props.compact}
				refresh={result.refetch}
				state={mapShowActivity(result)}
			/>
		</>
	);
}
