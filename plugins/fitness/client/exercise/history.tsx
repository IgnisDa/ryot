import { PluginLink, type TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import { formatDuration, SegmentedControl } from "@ryot-app/plugin-ui-sdk";
import { formatDaysAgo } from "@ryot-app/plugin-ui-sdk/datetime";
import clsx from "clsx";
import { useState } from "react";

import type { ExerciseDetails } from "../../shared/exercise-details-recipes";
import type { PersonalBest } from "../../shared/workout-records";
import type { FitnessText } from "../messages";
import { useFitnessMessages } from "../messages";
import { setLotLabel, setLots } from "../set-lots";
import { ProcessingNote } from "../workout-processing";
import {
	formatMeasure,
	formatNumber,
	formatSetMain,
	formatShortDate,
	formatUnitValue,
	formatWeightedVolume,
} from "../workout/format";
import {
	bestWeightByReps,
	buildMonthSeries,
	buildStatTiles,
	daysSince,
	type ExerciseRecord,
	isLapsed,
	latestPersonalBests,
	type Metric,
	metricsForKind,
	type MonthPoint,
	peakPoint,
	type PersonalBestRow,
	personalBestTitle,
	type SeriesRange,
	seriesRanges,
} from "./details-model";
import { cardClass, cardHeadingClass, sectionHeadingClass } from "./styles";

type Session = ExerciseDetails["sessions"][number];

const formatMetric = (
	formatters: Formatters,
	text: FitnessText,
	value: number,
	unit: Metric["unit"],
) => {
	if (unit === "kg-reps") {
		return formatWeightedVolume(formatters, text, value, false);
	}
	if (unit === "kmh") {
		return formatUnitValue(formatters, Math.round(value * 10) / 10, "km/h");
	}
	return unit === "sessions"
		? formatNumber(formatters, value)
		: formatMeasure(formatters, text, value, unit);
};

function StatTiles(props: {
	readonly compact: boolean;
	readonly details: ExerciseDetails;
	readonly kind: ExerciseRecord["kind"];
}) {
	const formatters = useFormatters();
	const text = useFitnessMessages();
	const tiles = buildStatTiles(
		formatters,
		text,
		props.kind,
		props.details.totals,
		props.details.months,
	);
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
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { metric, points } = props;
	const peak = peakPoint(points);
	const first = points[0];
	const last = points.at(-1);
	if (peak === null || first === undefined || last === undefined) {
		return (
			<p className="py-10 text-center text-[14px] text-text-muted">
				{text("client.exercise.history.no-results")}
			</p>
		);
	}
	const top = peak.value ?? 1;
	return (
		<div className="flex flex-col gap-1">
			<div
				role="img"
				className="flex h-40 items-end gap-px border-b border-border"
				aria-label={text("client.exercise.history.chart-label", {
					last: last.label,
					peak: peak.label,
					first: first.label,
					top: formatMetric(formatters, text, top, metric.unit),
					title: text("client.exercise.metric.title", { metric: metric.key }),
				})}
			>
				{points.map((point) => (
					<span
						key={point.index}
						className={clsx(
							"min-w-px flex-1 rounded-t-sm",
							point.value === null || point.value <= 0 ? "h-px bg-border" : "bg-accent",
						)}
						style={
							point.value === null || point.value <= 0
								? undefined
								: { height: `${Math.max((point.value / top) * 100, 2)}%` }
						}
						title={
							point.value === null
								? text("client.exercise.history.bar-empty", { label: point.label })
								: text("client.exercise.history.bar-value", {
										label: point.label,
										value: formatMetric(formatters, text, point.value, metric.unit),
									})
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
	readonly timeZone: TimeZone;
	readonly details: ExerciseDetails;
	readonly kind: ExerciseRecord["kind"];
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const metrics = metricsForKind(props.kind);
	const [metricKey, setMetricKey] = useState(metrics[0]?.key);
	const [range, setRange] = useState<SeriesRange>("all");
	const metric = metrics.find((entry) => entry.key === metricKey) ?? metrics[0];
	if (metric === undefined) {
		return null;
	}
	const points = buildMonthSeries(formatters, {
		range,
		metric,
		now: props.now,
		timeZone: props.timeZone,
		months: props.details.months,
	});
	const peak = peakPoint(points);
	const peakLabel =
		peak?.value == null
			? text("client.exercise.history.no-data")
			: text("client.exercise.history.peak", {
					label: peak.label,
					value: formatMetric(formatters, text, peak.value, metric.unit),
				});
	return (
		<div className={cardClass}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h3 className={cardHeadingClass}>
						{text("client.exercise.metric.title", { metric: metric.key })}
					</h3>
					<span className="text-[13px] text-text-muted">{peakLabel}</span>
				</div>
				<div className="flex flex-wrap gap-2">
					{metrics.length > 1 ? (
						<SegmentedControl
							value={metric.key}
							optionClassName="px-3"
							onChange={setMetricKey}
							label={text("client.measurements.column-metric")}
							options={metrics.map((entry) => ({
								value: entry.key,
								label: text("client.exercise.metric.label", { metric: entry.key }),
								content: (
									<span className="text-[13px] font-semibold">
										{text("client.exercise.metric.label", { metric: entry.key })}
									</span>
								),
							}))}
						/>
					) : null}
					<SegmentedControl
						value={range}
						onChange={setRange}
						optionClassName="px-3"
						label={text("client.exercise.history.range")}
						options={seriesRanges.map((entry) => ({
							value: entry,
							label: text("client.exercise.range", { range: entry }),
							content: (
								<span className="text-[13px] font-semibold">
									{text("client.exercise.range", { range: entry })}
								</span>
							),
						}))}
					/>
				</div>
			</div>
			<MonthChart metric={metric} points={points} />
		</div>
	);
}

const personalBestValues = (
	formatters: Formatters,
	text: FitnessText,
): Readonly<Record<PersonalBest, (row: PersonalBestRow) => null | string>> => ({
	reps: (row) => (row.reps === null ? null : formatNumber(formatters, row.reps)),
	time: (row) => (row.duration === null ? null : formatDuration(formatters, row.duration)),
	one_rm: (row) =>
		row.oneRm === null ? null : formatMeasure(formatters, text, row.oneRm, "weight"),
	weight: (row) =>
		row.weight === null ? null : formatMeasure(formatters, text, row.weight, "weight"),
	volume: (row) =>
		row.volume === null ? null : formatMetric(formatters, text, row.volume, "kg-reps"),
	distance: (row) =>
		row.distance === null ? null : formatMeasure(formatters, text, row.distance, "distance"),
	pace: (row) =>
		row.distance === null || row.duration === null || row.duration === 0
			? null
			: formatMetric(formatters, text, (row.distance / row.duration) * 3600, "kmh"),
});

export function RecentSessions(props: {
	readonly compact: boolean;
	readonly details: ExerciseDetails;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	if (props.details.sessions.length === 0) {
		return null;
	}
	return (
		<section className="flex flex-col gap-4" aria-labelledby="exercise-sessions">
			<h2 id="exercise-sessions" className={sectionHeadingClass}>
				{text("client.exercise.history.recent-sessions")}
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
								{session.startedAt === null
									? null
									: formatShortDate(formatters, session.startedAt, null)}
							</span>
						</div>
						<ul
							className="flex flex-wrap gap-2"
							aria-label={text("client.exercise.history.sets-in", { name: session.name })}
						>
							{session.sets.items.map((set) => (
								<SessionSet set={set} key={set.id} />
							))}
						</ul>
					</li>
				))}
			</ul>
		</section>
	);
}

export function HistorySection(props: {
	readonly now: Date;
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly details: ExerciseDetails;
	readonly exercise: ExerciseRecord;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { now, compact, details, exercise, timeZone } = props;
	const { totals } = details;
	if (totals.sets === 0) {
		return (
			<section className="flex flex-col gap-4" aria-labelledby="exercise-history">
				<h2 id="exercise-history" className={sectionHeadingClass}>
					{text("client.exercise.history.title")}
				</h2>
				<p className={clsx(cardClass, "text-[15px] text-text-muted")}>
					{text("client.exercise.history.empty")}
				</p>
			</section>
		);
	}
	const lapsed = isLapsed(totals.lastAt, now, timeZone);
	const days = daysSince(totals.lastAt, now, timeZone);
	const since = totals.firstAt === null ? null : formatShortDate(formatters, totals.firstAt, null);
	const lastDate = totals.lastAt === null ? null : formatShortDate(formatters, totals.lastAt, null);
	return (
		<section className="flex flex-col gap-4" aria-labelledby="exercise-history">
			<div className="flex flex-wrap items-baseline justify-between gap-2 font-ui">
				<h2 id="exercise-history" className={sectionHeadingClass}>
					{text("client.exercise.history.title")}
				</h2>
				<span className="text-[14px] text-text-muted">
					{[
						since === null ? null : text("client.exercise.history.since", { date: since }),
						days === null
							? null
							: text("client.exercise.history.last-trained", {
									ago: formatDaysAgo(formatters, days),
								}),
					]
						.filter((part) => part !== null)
						.join(" · ")}
				</span>
			</div>
			{lapsed ? (
				<p
					role="status"
					className="rounded-xl border border-accent-border bg-accent-soft p-4 font-ui text-[15px] text-text"
				>
					<strong>
						{days === null
							? null
							: text("client.exercise.history.last-done", { ago: formatDaysAgo(formatters, days) })}
					</strong>
					{lastDate === null ? null : (
						<> {text("client.exercise.history.last-session", { date: lastDate })}</>
					)}
				</p>
			) : null}
			<ProcessingNote />
			<StatTiles compact={compact} details={details} kind={exercise.kind} />
			<div className={clsx("grid gap-4", !compact && "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
				<ProgressChart now={now} details={details} timeZone={timeZone} kind={exercise.kind} />
				<PersonalBests rows={details.personalBests} />
			</div>
			{exercise.kind === "reps_and_weight" ? <BestWeightByReps details={details} /> : null}
		</section>
	);
}

function SessionSet(props: { readonly set: Session["sets"]["items"][number] }) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { set } = props;
	const lot = setLots[set.setLot ?? "normal"];
	return (
		<li
			data-set-lot={set.setLot ?? "normal"}
			className={clsx(
				"flex items-center gap-1.5 rounded-pill border px-3 py-1 text-[13px] tabular-nums",
				lot.pill,
			)}
		>
			{formatSetMain(formatters, text, set.exerciseKind, set)}
			{lot.tag === undefined ? null : (
				<span className="text-[11px] font-semibold uppercase">
					{setLotLabel(text, set.setLot ?? "normal")}
				</span>
			)}
		</li>
	);
}

function BestWeightByReps(props: { readonly details: ExerciseDetails }) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const rows = bestWeightByReps(props.details.totals);
	if (rows.length === 0) {
		return null;
	}
	return (
		<div className={cardClass}>
			<div className="flex flex-col gap-1">
				<h3 className={cardHeadingClass}>{text("client.exercise.history.best-weight")}</h3>
				<span className="text-[13px] text-text-muted">
					{text("client.exercise.history.best-weight-note")}
				</span>
			</div>
			<ul className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
				{rows.map(({ reps, weight }) => (
					<li
						key={reps}
						className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3"
					>
						<span className="text-[13px] text-text-muted">
							{text("client.format.reps", { count: reps })}
						</span>
						<span className="font-semibold text-[16px] text-text tabular-nums">
							{formatMeasure(formatters, text, weight, "weight")}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function PersonalBests(props: { readonly rows: ExerciseDetails["personalBests"] }) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const entries = latestPersonalBests(props.rows)
		.map((entry) => ({ entry, value: personalBestValues(formatters, text)[entry.type](entry.row) }))
		.filter(({ value }) => value !== null);
	if (entries.length === 0) {
		return null;
	}
	return (
		<div className={cardClass}>
			<h3 className={cardHeadingClass}>{text("client.exercise.history.personal-bests")}</h3>
			<ul className="flex flex-col divide-y divide-border">
				{entries.map(({ entry, value }) => (
					<li key={entry.type} className="flex items-baseline justify-between gap-4 py-2">
						<div className="flex min-w-0 flex-col">
							<span className="text-[14px] text-text">{personalBestTitle(text, entry.type)}</span>
							<PluginLink
								className="truncate text-[13px] text-accent-text"
								to={{ kind: "entity", entityId: entry.row.workoutId }}
							>
								{formatSetMain(formatters, text, entry.row.exerciseKind, entry.row)} ·{" "}
								{formatShortDate(formatters, entry.row.occurredAt, null)}
							</PluginLink>
						</div>
						<span className="font-semibold text-[16px] text-text tabular-nums">{value}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
