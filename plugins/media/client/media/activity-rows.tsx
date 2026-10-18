import {
	StatStrip,
	Timeline,
	TimelineEntry,
	TimelineGroup,
	type TimelineMarker,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type ReactNode, useState } from "react";

import { MediaActivityRowMenu } from "./activity-row-menu";
import {
	type MediaActivityCompletedWatch,
	mediaActivityDateLabel,
	type MediaActivityFigure,
	mediaActivityRatingLabel,
	type MediaActivityReviewRow,
	type MediaActivityRowBase,
	type MediaActivityTimeline,
} from "./activity-timeline";
import { formatLocalMonthLabel } from "./date";

export type MediaActivityRowRender<Row extends MediaActivityRowBase> = {
	readonly segmentNoun: string;
	readonly rowBody: (row: Row) => ReactNode;
	readonly rowLabel: (row: Row) => string;
	readonly rowRun?: (row: Row) => string | undefined;
	readonly rowSource: (row: Row) => string | undefined;
	readonly rowExpand?: (row: Row) => MediaActivityRowExpand | undefined;
	readonly monthSummary?: (rows: readonly Row[]) => string | undefined;
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
			actions={<MediaActivityRowMenu row={row} />}
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

const MONTHLY_DAY_THRESHOLD = 8;

const monthKeyOf = (row: MediaActivityRowBase) =>
	row.dateKey === "date-unknown" ? row.dateKey : row.dateKey.slice(0, 7);

const monthGroups = <Row extends MediaActivityRowBase>(rows: readonly Row[]) => {
	const groups: { readonly key: string; readonly rows: Row[]; readonly first: Row }[] = [];
	for (const row of rows) {
		const key = monthKeyOf(row);
		const last = groups.at(-1);
		if (last?.key === key) {
			last.rows.push(row);
		} else {
			groups.push({ key, first: row, rows: [row] });
		}
	}
	return groups;
};

function MediaActivityDays<Row extends MediaActivityRowBase>(props: {
	readonly compact: boolean;
	readonly rows: readonly Row[];
	readonly render: MediaActivityRowRender<Row>;
}) {
	return dateGroups(props.rows).map((group) => (
		<TimelineGroup
			key={group.first.key}
			compact={props.compact}
			label={mediaActivityDateLabel(group.first)}
		>
			{group.rows.map((row) => (
				<MediaActivityEntry row={row} key={row.key} render={props.render} />
			))}
		</TimelineGroup>
	));
}

const monthDetail = <Row extends MediaActivityRowBase>(
	rows: readonly Row[],
	render: MediaActivityRowRender<Row>,
) => {
	const days = new Set(rows.map(({ dateKey }) => dateKey)).size;
	const summary =
		render.monthSummary?.(rows) ?? (rows.length === 1 ? "1 entry" : `${rows.length} entries`);
	return `${summary} · ${days === 1 ? "1 day" : `${days} days`}`;
};

function MediaActivityMonth<Row extends MediaActivityRowBase>(props: {
	readonly compact: boolean;
	readonly initiallyOpen: boolean;
	readonly rows: readonly Row[];
	readonly first: Row;
	readonly render: MediaActivityRowRender<Row>;
}) {
	const [open, setOpen] = useState(props.initiallyOpen);
	const label =
		props.first.dateKey === "date-unknown"
			? "Date unknown"
			: formatLocalMonthLabel(props.first.occurredAt);
	return (
		<section aria-label={label} className="grid gap-3">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-hover pointer-coarse:min-h-11"
			>
				<AppIcon
					size={14}
					name="chevron-right"
					className={clsx("shrink-0 text-text-subtle transition-transform", open && "rotate-90")}
				/>
				<span className="shrink-0 text-label font-semibold text-text">{label}</span>
				<span className="min-w-0 flex-1 truncate text-right text-micro text-text-subtle">
					{monthDetail(props.rows, props.render)}
				</span>
			</button>
			{open ? (
				<Timeline>
					<MediaActivityDays rows={props.rows} render={props.render} compact={props.compact} />
				</Timeline>
			) : null}
		</section>
	);
}

export function MediaActivityRows<Row extends MediaActivityRowBase>(props: {
	readonly compact: boolean;
	readonly rows: readonly Row[];
	readonly render: MediaActivityRowRender<Row>;
	readonly monthly?: { readonly openNewest: boolean } | undefined;
}) {
	const months = monthGroups(props.rows);
	if (
		props.monthly === undefined ||
		months.length < 2 ||
		dateGroups(props.rows).length <= MONTHLY_DAY_THRESHOLD
	) {
		return (
			<Timeline>
				<MediaActivityDays rows={props.rows} render={props.render} compact={props.compact} />
			</Timeline>
		);
	}
	const { openNewest } = props.monthly;
	return (
		<div className="grid gap-2">
			{months.map((month, index) => (
				<MediaActivityMonth
					key={month.key}
					rows={month.rows}
					first={month.first}
					render={props.render}
					compact={props.compact}
					initiallyOpen={openNewest && index === 0}
				/>
			))}
		</div>
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
		return (
			<MediaActivityRows
				render={render}
				compact={compact}
				rows={props.timeline.rows}
				monthly={{ openNewest: true }}
			/>
		);
	}
	const { open, completed } = props.timeline;
	const noun = render.segmentNoun;
	return (
		<div className="flex flex-col gap-5">
			{open === undefined ? null : (
				<div>
					<MediaActivityWatchSeparator label={`Since the last ${noun.toLowerCase()}`} />
					<MediaActivityRows
						rows={open}
						render={render}
						compact={compact}
						monthly={{ openNewest: true }}
					/>
				</div>
			)}
			{completed.map((segment, index) => (
				<div key={segment.key}>
					<MediaActivityWatchSeparator
						label={segmentSeparatorLabel({ noun, index, segment, total: completed.length })}
					/>
					<MediaActivityRows
						render={render}
						compact={compact}
						rows={segment.rows}
						monthly={{ openNewest: open === undefined && index === 0 }}
					/>
				</div>
			))}
		</div>
	);
}
