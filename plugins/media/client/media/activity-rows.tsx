import clsx from "clsx";
import { useState, type ReactNode } from "react";

import {
	mediaActivityDateLabel,
	mediaActivityRatingLabel,
	type MediaActivityCompletedWatch,
	type MediaActivityReviewRow,
	type MediaActivityRowBase,
	type MediaActivityTimeline,
} from "./activity-timeline";
import { MediaFact } from "./primitives";

export type MediaActivityRowRender<Row extends MediaActivityRowBase> = {
	readonly rowBody: (row: Row) => ReactNode;
	readonly rowLabel: (row: Row) => string;
	readonly markerTone: Record<Row["type"], string>;
	readonly rowSource: (row: Row) => string | undefined;
};

export type MediaActivityFigure = {
	readonly label: string;
	readonly value: string;
	readonly detail: string | undefined;
};

export function MediaActivitySummaryFigures(props: {
	readonly compact: boolean;
	readonly figures: readonly MediaActivityFigure[];
}) {
	return (
		<div className="flex flex-wrap gap-y-4 rounded-lg border border-border bg-surface px-3.5 py-3">
			{props.figures.map((figure) => (
				<div
					key={figure.label}
					className={clsx("flex flex-col gap-0.5", props.compact ? "w-1/2" : "w-1/4")}
				>
					<MediaFact label={figure.label} value={figure.value} />
					{figure.detail === undefined ? null : (
						<p className="font-ui text-[11px] text-text-subtle">{figure.detail}</p>
					)}
				</div>
			))}
		</div>
	);
}

function MediaActivityMarker<Row extends MediaActivityRowBase>(props: {
	readonly row: Row;
	readonly markerTone: Record<Row["type"], string>;
}) {
	const isBeat = props.row.type === "completion";
	return (
		<div
			className={clsx(
				"rounded-pill",
				props.markerTone[props.row.type as Row["type"]],
				isBeat && "h-3 w-3 border-2 border-accent bg-transparent",
				!isBeat && "h-2 w-2",
				props.row.type === "collection" && "border border-border",
			)}
		/>
	);
}

function MediaActivityReviewBody(props: { readonly text: string; readonly isSpoiler: boolean }) {
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

export function MediaActivityReviewDetail<Subject>(props: {
	readonly row: MediaActivityReviewRow<Subject>;
}) {
	const { row } = props;
	return (
		<div className="flex flex-col gap-1 border-l-2 border-accent-border pl-2.5">
			{row.rating === undefined ? null : (
				<p className="font-ui font-medium text-[11px] text-accent-text">
					{mediaActivityRatingLabel(row.rating)}
				</p>
			)}
			{row.body === undefined ? null : (
				<MediaActivityReviewBody text={row.body.text} isSpoiler={row.body.isSpoiler} />
			)}
		</div>
	);
}

function MediaActivityEntry<Row extends MediaActivityRowBase>(props: {
	readonly row: Row;
	readonly isLast: boolean;
	readonly showDate: boolean;
	readonly render: MediaActivityRowRender<Row>;
}) {
	const { row, render } = props;
	const source = render.rowSource(row);
	const isHeading = row.type === "completion" || row.type === "beat";
	return (
		<div className="flex">
			<div className="w-16 pt-1.5">
				{props.showDate ? (
					<p className="font-ui text-[11px] text-text-subtle">{mediaActivityDateLabel(row)}</p>
				) : null}
			</div>
			<div className="flex w-3.5 flex-col items-center pt-2">
				<MediaActivityMarker row={row} markerTone={render.markerTone} />
				{props.isLast ? null : <div className="w-px flex-1 bg-border" />}
			</div>
			<div className={clsx("flex min-w-0 flex-1 flex-col gap-1.5 pl-3", !props.isLast && "pb-4")}>
				<div className="flex items-baseline justify-between gap-2.5">
					<p
						className={clsx(
							"min-w-0 flex-1",
							isHeading && "font-display font-semibold text-[15px] text-text",
							!isHeading &&
								(row.type === "collection"
									? "font-ui text-[13px] text-text-muted"
									: "font-ui font-medium text-[13.5px] text-text"),
						)}
					>
						{render.rowLabel(row)}
					</p>
					{source === undefined ? null : (
						<span className="rounded-pill border border-border px-1.5 font-ui text-[10.5px] text-text-subtle">
							{source}
						</span>
					)}
				</div>
				{render.rowBody(row)}
			</div>
		</div>
	);
}

export function MediaActivityRows<Row extends MediaActivityRowBase>(props: {
	readonly rows: readonly Row[];
	readonly render: MediaActivityRowRender<Row>;
}) {
	return (
		<div>
			{props.rows.map((row, index) => (
				<MediaActivityEntry
					row={row}
					key={row.key}
					render={props.render}
					isLast={index === props.rows.length - 1}
					showDate={props.rows[index - 1]?.dateKey !== row.dateKey}
				/>
			))}
		</div>
	);
}

function MediaActivityWatchSeparator(props: { readonly label: string }) {
	return (
		<div className="flex items-center gap-2.5 pb-3.5">
			<p className="font-ui font-medium text-[11px] tracking-widest text-text-subtle uppercase">
				{props.label}
			</p>
			<div className="h-px flex-1 bg-border" />
		</div>
	);
}

const watchSeparatorLabel = <Row extends MediaActivityRowBase>(
	watch: MediaActivityCompletedWatch<Row>,
	index: number,
	total: number,
) => `Watch ${total - index} · ${mediaActivityDateLabel(watch.completion)}`;

export function MediaActivityTimelineView<Row extends MediaActivityRowBase>(props: {
	readonly render: MediaActivityRowRender<Row>;
	readonly timeline: MediaActivityTimeline<Row>;
}) {
	if (props.timeline.layout === "flat") {
		return <MediaActivityRows render={props.render} rows={props.timeline.rows} />;
	}
	const { open, completed } = props.timeline;
	return (
		<div className="flex flex-col gap-5">
			{open === undefined ? null : (
				<div>
					<MediaActivityWatchSeparator label="Since the last watch" />
					<MediaActivityRows rows={open} render={props.render} />
				</div>
			)}
			{completed.map((watch, index) => (
				<div key={watch.key}>
					<MediaActivityWatchSeparator
						label={watchSeparatorLabel(watch, index, completed.length)}
					/>
					<MediaActivityRows rows={watch.rows} render={props.render} />
				</div>
			))}
		</div>
	);
}
