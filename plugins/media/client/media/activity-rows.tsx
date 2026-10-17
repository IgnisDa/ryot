import {
	StatStrip,
	Timeline,
	TimelineEntry,
	TimelineGroup,
	type TimelineMarker,
} from "@ryot-app/plugin-ui-sdk";
import { type ReactNode, useState } from "react";

import {
	type MediaActivityCompletedWatch,
	mediaActivityDateLabel,
	type MediaActivityFigure,
	mediaActivityRatingLabel,
	type MediaActivityReviewRow,
	type MediaActivityRowBase,
	type MediaActivityTimeline,
} from "./activity-timeline";

export type MediaActivityRowRender<Row extends MediaActivityRowBase> = {
	readonly segmentNoun: string;
	readonly rowBody: (row: Row) => ReactNode;
	readonly rowLabel: (row: Row) => string;
	readonly rowRun?: (row: Row) => string | undefined;
	readonly rowSource: (row: Row) => string | undefined;
	readonly rowExpand?: (row: Row) => MediaActivityRowExpand | undefined;
};

export type MediaActivityRowExpand = {
	readonly content: ReactNode;
	readonly label: (expanded: boolean) => string;
};

export function MediaActivitySummaryFigures(props: {
	readonly compact: boolean;
	readonly figures: readonly MediaActivityFigure[];
}) {
	return (
		<StatStrip
			compact={props.compact}
			stats={props.figures.map((figure) => ({
				key: figure.label,
				label: figure.label,
				value: figure.value,
				detail: figure.detail,
			}))}
		/>
	);
}

const MARKERS: Partial<Record<string, TimelineMarker>> = {
	review: { tone: "info" },
	watch: { tone: "success" },
	progress: { tone: "accent" },
	completion: { emphasis: true, tone: "success" },
};

const markerOf = (type: string): TimelineMarker => MARKERS[type] ?? { tone: "muted" };

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
				<span className="text-label text-text-muted">Spoiler — show review</span>
			</button>
		);
	}
	return <p className="text-label text-text-muted">{props.text}</p>;
}

export function MediaActivityReviewDetail<Subject>(props: {
	readonly row: MediaActivityReviewRow<Subject>;
}) {
	const { row } = props;
	return (
		<div className="flex flex-col gap-1 border-l-2 border-accent-border pl-2.5">
			{row.rating === undefined ? null : (
				<p className="text-micro font-medium text-accent-text">
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
	readonly render: MediaActivityRowRender<Row>;
}) {
	const { row, render } = props;
	const [expanded, setExpanded] = useState(false);
	const source = render.rowSource(row);
	const run = render.rowRun?.(row);
	const expand = render.rowExpand?.(row);
	const hasMeta = source !== undefined || run !== undefined;
	return (
		<TimelineEntry
			marker={markerOf(row.type)}
			title={render.rowLabel(row)}
			expand={
				expand === undefined
					? undefined
					: {
							expanded,
							content: expand.content,
							label: expand.label(expanded),
							onToggle: () => setExpanded(!expanded),
						}
			}
			meta={
				hasMeta ? (
					<>
						{source === undefined ? null : (
							<span className="rounded-pill border border-border px-1.5 text-micro text-text-subtle">
								{source}
							</span>
						)}
						{run === undefined ? null : <span>{run}</span>}
					</>
				) : undefined
			}
		>
			{render.rowBody(row)}
		</TimelineEntry>
	);
}

const dateGroups = <Row extends MediaActivityRowBase>(rows: readonly Row[]) => {
	const groups: { readonly rows: Row[]; readonly first: Row }[] = [];
	for (const row of rows) {
		const last = groups.at(-1);
		if (last !== undefined && last.first.dateKey === row.dateKey) {
			last.rows.push(row);
		} else {
			groups.push({ first: row, rows: [row] });
		}
	}
	return groups;
};

export function MediaActivityRows<Row extends MediaActivityRowBase>(props: {
	readonly compact: boolean;
	readonly rows: readonly Row[];
	readonly render: MediaActivityRowRender<Row>;
}) {
	return (
		<Timeline>
			{dateGroups(props.rows).map((group) => (
				<TimelineGroup
					key={group.first.key}
					compact={props.compact}
					label={mediaActivityDateLabel(group.first)}
				>
					{group.rows.map((row) => (
						<MediaActivityEntry row={row} key={row.key} render={props.render} />
					))}
				</TimelineGroup>
			))}
		</Timeline>
	);
}

function MediaActivityWatchSeparator(props: { readonly label: string }) {
	return (
		<div className="flex items-center gap-2.5 pb-3.5">
			<p className="text-micro font-medium tracking-widest text-text-subtle uppercase">
				{props.label}
			</p>
			<div className="h-px flex-1 bg-border" />
		</div>
	);
}

const segmentSeparatorLabel = <Row extends MediaActivityRowBase>(input: {
	readonly noun: string;
	readonly index: number;
	readonly total: number;
	readonly segment: MediaActivityCompletedWatch<Row>;
}) =>
	`${input.noun} ${input.total - input.index} · ${mediaActivityDateLabel(input.segment.completion)}`;

export function MediaActivityTimelineView<Row extends MediaActivityRowBase>(props: {
	readonly compact: boolean;
	readonly render: MediaActivityRowRender<Row>;
	readonly timeline: MediaActivityTimeline<Row>;
}) {
	const { render, compact } = props;
	if (props.timeline.layout === "flat") {
		return <MediaActivityRows render={render} compact={compact} rows={props.timeline.rows} />;
	}
	const { open, completed } = props.timeline;
	const noun = render.segmentNoun;
	return (
		<div className="flex flex-col gap-5">
			{open === undefined ? null : (
				<div>
					<MediaActivityWatchSeparator label={`Since the last ${noun.toLowerCase()}`} />
					<MediaActivityRows rows={open} render={render} compact={compact} />
				</div>
			)}
			{completed.map((segment, index) => (
				<div key={segment.key}>
					<MediaActivityWatchSeparator
						label={segmentSeparatorLabel({ noun, index, segment, total: completed.length })}
					/>
					<MediaActivityRows render={render} compact={compact} rows={segment.rows} />
				</div>
			))}
		</div>
	);
}
