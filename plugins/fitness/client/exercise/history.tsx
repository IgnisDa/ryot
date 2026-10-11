import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { SegmentedControl } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { useState } from "react";

import type { ExerciseDetails } from "../../shared/exercise-details-recipes";
import type { PersonalBest } from "../../shared/workout-records";
import { setLots } from "../set-lots";
import {
	formatDuration,
	formatMeasure,
	formatNumber,
	formatSetMain,
	formatShortDate,
} from "../workout/format";
import {
	bestWeightByReps,
	buildMonthSeries,
	buildStatTiles,
	daysSince,
	describeAgo,
	isLapsed,
	latestPersonalBests,
	metricsForKind,
	peakPoint,
	personalBestTitles,
	seriesRanges,
	type ExerciseRecord,
	type Metric,
	type MonthPoint,
	type PersonalBestRow,
	type SeriesRange,
} from "./details-model";
import { cardClass, cardHeadingClass, sectionHeadingClass } from "./styles";

type Session = ExerciseDetails["sessions"][number];

const formatMetric = (value: number, unit: Metric["unit"]) => {
	if (unit === "kmh") {
		return `${formatNumber(Math.round(value * 10) / 10)} km/h`;
	}
	return unit === "sessions" ? formatNumber(value) : formatMeasure(value, unit);
};

function StatTiles(props: {
	readonly compact: boolean;
	readonly details: ExerciseDetails;
	readonly kind: ExerciseRecord["kind"];
}) {
	const tiles = buildStatTiles(props.kind, props.details.totals, props.details.months);
	return (
		<div
			className={clsx(
				"grid gap-px overflow-hidden rounded-xl border border-border bg-border",
				props.compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]",
			)}
		>
			{tiles.map((tile) => (
				<div key={tile.label} className="flex flex-col gap-1 bg-surface p-4 font-ui">
					<span className="text-[13px] text-text-muted">{tile.label}</span>
					<span
						className={clsx(
							"font-semibold leading-tight text-text tabular-nums",
							props.compact ? "text-xl" : "text-[28px]",
						)}
					>
						{tile.value}
					</span>
					{tile.detail === null || props.compact ? null : (
						<span className="text-[13px] text-text-muted">{tile.detail}</span>
					)}
				</div>
			))}
		</div>
	);
}

function MonthChart(props: { readonly metric: Metric; readonly points: readonly MonthPoint[] }) {
	const { metric, points } = props;
	const peak = peakPoint(points);
	const first = points[0];
	const last = points.at(-1);
	if (peak === null || first === undefined || last === undefined) {
		return (
			<p className="py-10 text-center text-[14px] text-text-muted">No sessions in this range.</p>
		);
	}
	const top = peak.value ?? 1;
	return (
		<div className="flex flex-col gap-1">
			<div
				role="img"
				className="flex h-40 items-end gap-px border-b border-border"
				aria-label={`${metric.title} from ${first.label} to ${last.label}, peaking at ${formatMetric(top, metric.unit)} in ${peak.label}`}
			>
				{points.map((point) => (
					<span
						key={point.index}
						title={`${point.label}: ${point.value === null ? "no sessions" : formatMetric(point.value, metric.unit)}`}
						className={clsx(
							"min-w-px flex-1 rounded-t-sm",
							point.value === null || point.value <= 0 ? "h-px bg-border" : "bg-accent",
						)}
						style={
							point.value === null || point.value <= 0
								? undefined
								: { height: `${Math.max((point.value / top) * 100, 2)}%` }
						}
					/>
				))}
			</div>
			<div aria-hidden="true" className="flex justify-between text-[12px] text-text-muted">
				<span>{first.label}</span>
				<span>{last.label}</span>
			</div>
		</div>
	);
}

function ProgressChart(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly details: ExerciseDetails;
	readonly kind: ExerciseRecord["kind"];
}) {
	const metrics = metricsForKind(props.kind);
	const [metricKey, setMetricKey] = useState(metrics[0]?.key);
	const [range, setRange] = useState<SeriesRange>("all");
	const metric = metrics.find((entry) => entry.key === metricKey) ?? metrics[0];
	if (metric === undefined) {
		return null;
	}
	const points = buildMonthSeries({
		range,
		metric,
		now: props.now,
		timeZone: props.timeZone,
		months: props.details.months,
	});
	const peak = peakPoint(points);
	return (
		<div className={cardClass}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h3 className={cardHeadingClass}>{metric.title}</h3>
					<span className="text-[13px] text-text-muted">
						{peak === null || peak.value === null
							? "No data yet"
							: `${formatMetric(peak.value, metric.unit)} peak · ${peak.label}`}
					</span>
				</div>
				<div className="flex flex-wrap gap-2">
					{metrics.length > 1 ? (
						<SegmentedControl
							label="Metric"
							value={metric.key}
							optionClassName="px-3"
							onChange={setMetricKey}
							options={metrics.map((entry) => ({
								value: entry.key,
								label: entry.label,
								content: <span className="text-[13px] font-semibold">{entry.label}</span>,
							}))}
						/>
					) : null}
					<SegmentedControl
						label="Range"
						value={range}
						onChange={setRange}
						optionClassName="px-3"
						options={seriesRanges.map((entry) => ({
							value: entry.value,
							label: entry.label,
							content: <span className="text-[13px] font-semibold">{entry.label}</span>,
						}))}
					/>
				</div>
			</div>
			<MonthChart metric={metric} points={points} />
		</div>
	);
}

const personalBestValues: Readonly<Record<PersonalBest, (row: PersonalBestRow) => string | null>> =
	{
		reps: (row) => (row.reps === null ? null : formatNumber(row.reps)),
		time: (row) => (row.duration === null ? null : formatDuration(row.duration)),
		one_rm: (row) => (row.oneRm === null ? null : formatMeasure(row.oneRm, "kg")),
		weight: (row) => (row.weight === null ? null : formatMeasure(row.weight, "kg")),
		volume: (row) => (row.volume === null ? null : formatMeasure(row.volume, "kg")),
		distance: (row) => (row.distance === null ? null : formatMeasure(row.distance, "km")),
		pace: (row) =>
			row.distance === null || row.duration === null || row.duration === 0
				? null
				: formatMetric((row.distance / row.duration) * 3600, "kmh"),
	};

function PersonalBests(props: {
	readonly rows: ExerciseDetails["personalBests"];
	readonly kind: ExerciseRecord["kind"];
}) {
	const entries = latestPersonalBests(props.rows)
		.map((entry) => ({ entry, value: personalBestValues[entry.type](entry.row) }))
		.filter(({ value }) => value !== null);
	if (entries.length === 0) {
		return null;
	}
	return (
		<div className={cardClass}>
			<h3 className={cardHeadingClass}>Personal bests</h3>
			<ul className="flex flex-col divide-y divide-border">
				{entries.map(({ entry, value }) => (
					<li key={entry.type} className="flex items-baseline justify-between gap-4 py-2">
						<div className="flex min-w-0 flex-col">
							<span className="text-[14px] text-text">{personalBestTitles[entry.type]}</span>
							<PluginLink
								className="truncate text-[13px] text-accent-text"
								to={{ kind: "entity", entityId: entry.row.workoutId }}
							>
								{formatSetMain(props.kind, entry.row)} ·{" "}
								{formatShortDate(entry.row.occurredAt, null)}
							</PluginLink>
						</div>
						<span className="font-semibold text-[16px] text-text tabular-nums">{value}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function BestWeightByReps(props: { readonly details: ExerciseDetails }) {
	const rows = bestWeightByReps(props.details.totals);
	if (rows.length === 0) {
		return null;
	}
	return (
		<div className={cardClass}>
			<div className="flex flex-col gap-1">
				<h3 className={cardHeadingClass}>Best weight by rep count</h3>
				<span className="text-[13px] text-text-muted">
					Heaviest set completed for at least that many reps
				</span>
			</div>
			<ul className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
				{rows.map(({ reps, weight }) => (
					<li
						key={reps}
						className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3"
					>
						<span className="text-[13px] text-text-muted">
							{reps} {reps === 1 ? "rep" : "reps"}
						</span>
						<span className="font-semibold text-[16px] text-text tabular-nums">
							{formatMeasure(weight, "kg")}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function HistorySection(props: {
	readonly now: Date;
	readonly compact: boolean;
	readonly timeZone: string;
	readonly details: ExerciseDetails;
	readonly exercise: ExerciseRecord;
}) {
	const { now, compact, details, exercise, timeZone } = props;
	const { totals } = details;
	if (totals.sets === 0) {
		return (
			<section className="flex flex-col gap-4" aria-labelledby="exercise-history">
				<h2 id="exercise-history" className={sectionHeadingClass}>
					Your history
				</h2>
				<p className={clsx(cardClass, "text-[15px] text-text-muted")}>
					You haven't logged this exercise yet. Your sessions, personal bests and progress will show
					up here after your first set.
				</p>
			</section>
		);
	}
	const lapsed = isLapsed(totals.lastAt, now);
	const days = daysSince(totals.lastAt, now);
	const since = totals.firstAt === null ? null : formatShortDate(totals.firstAt, null);
	const lastDate = totals.lastAt === null ? null : formatShortDate(totals.lastAt, null);
	return (
		<section className="flex flex-col gap-4" aria-labelledby="exercise-history">
			<div className="flex flex-wrap items-baseline justify-between gap-2 font-ui">
				<h2 id="exercise-history" className={sectionHeadingClass}>
					Your history
				</h2>
				<span className="text-[14px] text-text-muted">
					{since === null ? null : `Since ${since}`}
					{days === null ? null : ` · last trained ${describeAgo(days)}`}
				</span>
			</div>
			{lapsed ? (
				<p
					role="status"
					className="rounded-xl border border-accent-border bg-accent-soft p-4 font-ui text-[15px] text-text"
				>
					<strong>Last done {days === null ? "" : describeAgo(days)}.</strong>
					{lastDate === null ? null : ` Your last session was on ${lastDate}.`}
				</p>
			) : null}
			<StatTiles compact={compact} details={details} kind={exercise.kind} />
			<div className={clsx("grid gap-4", !compact && "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
				<ProgressChart now={now} details={details} timeZone={timeZone} kind={exercise.kind} />
				<PersonalBests kind={exercise.kind} rows={details.personalBests} />
			</div>
			{exercise.kind === "reps_and_weight" ? <BestWeightByReps details={details} /> : null}
		</section>
	);
}

function SessionSet(props: {
	readonly kind: ExerciseRecord["kind"];
	readonly set: Session["sets"]["items"][number];
}) {
	const { set, kind } = props;
	const lot = setLots[set.setLot ?? "normal"];
	return (
		<li
			data-set-lot={set.setLot ?? "normal"}
			className={clsx(
				"flex items-center gap-1.5 rounded-pill border px-3 py-1 text-[13px] tabular-nums",
				lot.pill,
			)}
		>
			{formatSetMain(kind, set)}
			{lot.tag === undefined ? null : (
				<span className="text-[11px] font-semibold uppercase">{lot.label}</span>
			)}
		</li>
	);
}

export function RecentSessions(props: {
	readonly compact: boolean;
	readonly details: ExerciseDetails;
	readonly kind: ExerciseRecord["kind"];
}) {
	if (props.details.sessions.length === 0) {
		return null;
	}
	return (
		<section className="flex flex-col gap-4" aria-labelledby="exercise-sessions">
			<h2 id="exercise-sessions" className={sectionHeadingClass}>
				Recent sessions
			</h2>
			<ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface font-ui">
				{props.details.sessions.map((session) => (
					<li
						key={session.id}
						className={clsx(
							"flex gap-3 p-4",
							props.compact ? "flex-col" : "items-center justify-between",
						)}
					>
						<div className="flex min-w-0 flex-col">
							<PluginLink
								to={{ kind: "entity", entityId: session.id }}
								className="truncate font-semibold text-[15px] text-accent-text"
							>
								{session.name}
							</PluginLink>
							<span className="text-[13px] text-text-muted">
								{session.startedAt === null ? null : formatShortDate(session.startedAt, null)}
							</span>
						</div>
						<ul className="flex flex-wrap gap-2" aria-label={`Sets in ${session.name}`}>
							{session.sets.items.map((set) => (
								<SessionSet set={set} key={set.id} kind={props.kind} />
							))}
						</ul>
					</li>
				))}
			</ul>
		</section>
	);
}
