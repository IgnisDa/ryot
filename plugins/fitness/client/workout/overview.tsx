import { PluginLink } from "@ryot-app/client-sdk/plugin";
import { Button, Menu } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { useRef, useState } from "react";

import type { WorkoutDetails } from "../../shared/workout-details-recipes";
import type {
	MuscleCount,
	TimelineSegment,
	WorkoutSummary,
	WorkoutTimeline,
} from "./details-model";
import {
	formatDuration,
	formatLongDate,
	formatNumber,
	formatShortDate,
	formatSignedMeasure,
	formatTimeRange,
} from "./format";

function WorkoutActions(props: { readonly compact: boolean }) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const later = (action: string) => () => {
		setMenuOpen(false);
		console.log(`TODO: ${action}`);
	};
	return (
		<div className={clsx("flex gap-2", props.compact && "w-full")}>
			<Button onClick={later("repeat workout")} className={clsx(props.compact && "flex-1")}>
				Repeat workout
			</Button>
			<Button variant="secondary" onClick={later("edit workout")}>
				Edit
			</Button>
			<Button
				ref={trigger}
				variant="secondary"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				aria-label="More workout actions"
				onClick={() => setMenuOpen((open) => !open)}
			>
				<AppIcon size={18} name="more-horizontal" />
			</Button>
			{menuOpen ? (
				<Menu
					triggerRef={trigger}
					activeIndex={activeIndex}
					label="More workout actions"
					onActiveIndexChange={setActiveIndex}
					onClose={(restoreFocus) => {
						setMenuOpen(false);
						if (restoreFocus) {
							trigger.current?.focus();
						}
					}}
					items={[
						{ key: "adjust-time", label: "Adjust time", onSelect: later("adjust workout time") },
						{
							key: "collections",
							label: "Add to collection",
							onSelect: later("add workout to collection"),
						},
						{
							key: "delete",
							destructive: true,
							label: "Delete workout",
							onSelect: later("delete workout"),
						},
					]}
				/>
			) : null}
		</div>
	);
}

function LinkedWorkout(props: {
	readonly label: string;
	readonly workoutStartedAt: string | null;
	readonly linked:
		| { readonly id: string; readonly name: string; readonly startedAt?: string | null }
		| undefined;
}) {
	if (props.linked === undefined) {
		return null;
	}
	const date =
		props.linked.startedAt === undefined || props.linked.startedAt === null
			? null
			: formatShortDate(props.linked.startedAt, props.workoutStartedAt);
	return (
		<PluginLink className="text-accent-text" to={{ kind: "entity", entityId: props.linked.id }}>
			{props.label} {props.linked.name}
			{date === null ? "" : ` · ${date}`}
		</PluginLink>
	);
}

export function WorkoutHeader(props: {
	readonly compact: boolean;
	readonly workout: WorkoutDetails;
}) {
	const { workout } = props;
	const date = formatLongDate(workout.startedAt);
	const time = formatTimeRange(workout.startedAt, workout.endedAt);
	return (
		<header
			className={clsx(
				"flex gap-4",
				props.compact ? "flex-col" : "flex-row flex-wrap items-end justify-between",
			)}
		>
			<div className="flex min-w-0 flex-col gap-2">
				<span className="font-ui font-semibold text-[13px] tracking-wide text-accent-text uppercase">
					Workout
				</span>
				<h1
					className={clsx(
						"font-display font-semibold text-text",
						props.compact ? "text-[34px] leading-tight" : "text-5xl leading-none",
					)}
				>
					{workout.name}
				</h1>
				<p className="flex flex-wrap gap-x-3 gap-y-1 font-ui text-[15px] text-text-muted">
					{date === null ? null : <span>{date}</span>}
					{time === null ? null : <span>{time}</span>}
					<LinkedWorkout
						label="Repeated from"
						workoutStartedAt={workout.startedAt}
						linked={workout.repeatedFrom.items[0]}
					/>
					<LinkedWorkout
						label="Template:"
						linked={workout.template.items[0]}
						workoutStartedAt={workout.startedAt}
					/>
				</p>
			</div>
			<WorkoutActions compact={props.compact} />
		</header>
	);
}

type Stat = {
	readonly label: string;
	readonly value: string;
	readonly unit?: string | undefined;
	readonly detail?: string | null | undefined;
	readonly tone?: "accent" | "success" | undefined;
};

const summaryStats = (workout: WorkoutDetails, summary: WorkoutSummary) => {
	const stats: ReadonlyArray<Stat | null> = [
		summary.durationSeconds === null
			? null
			: {
					label: "Duration",
					value: formatDuration(summary.durationSeconds),
					detail: formatTimeRange(workout.startedAt, workout.endedAt),
				},
		summary.volume > 0
			? {
					unit: "kg",
					label: "Volume",
					value: formatNumber(summary.volume),
					tone: summary.volumeDelta !== null && summary.volumeDelta > 0 ? "success" : undefined,
					detail:
						summary.volumeDelta === null
							? null
							: `${formatSignedMeasure(summary.volumeDelta, "kg")} vs previous sessions`,
				}
			: null,
		{
			label: "Sets",
			value: formatNumber(summary.sets),
			detail: `${summary.exercises} ${summary.exercises === 1 ? "exercise" : "exercises"}`,
		},
		summary.reps > 0 ? { label: "Reps", value: formatNumber(summary.reps) } : null,
		summary.restSeconds > 0
			? {
					label: "Rest",
					value: formatDuration(summary.restSeconds),
					detail:
						summary.durationSeconds === null || summary.durationSeconds === 0
							? null
							: `${Math.round((summary.restSeconds / summary.durationSeconds) * 100)}% of the session`,
				}
			: null,
		summary.records > 0
			? {
					tone: "accent",
					label: "Records",
					value: formatNumber(summary.records),
					detail: `Across ${summary.recordSets} ${summary.recordSets === 1 ? "set" : "sets"}`,
				}
			: null,
		workout.caloriesBurnt !== null && workout.caloriesBurnt > 0
			? { label: "Calories", value: formatNumber(workout.caloriesBurnt) }
			: null,
	];
	return stats.filter((stat) => stat !== null);
};

export function WorkoutSummaryRow(props: {
	readonly compact: boolean;
	readonly summary: WorkoutSummary;
	readonly workout: WorkoutDetails;
}) {
	return (
		<section
			aria-label="Summary"
			className={clsx(
				"grid gap-px overflow-hidden rounded-xl border border-border bg-border",
				props.compact ? "grid-cols-3" : "grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]",
			)}
		>
			{summaryStats(props.workout, props.summary).map((stat) => (
				<div key={stat.label} className="flex flex-col gap-1 bg-surface p-4 font-ui">
					<span className="text-[13px] text-text-muted">{stat.label}</span>
					<span
						className={clsx(
							"font-semibold leading-tight text-text tabular-nums",
							props.compact ? "text-xl" : "text-[28px]",
						)}
					>
						{stat.value}
						{stat.unit === undefined ? null : (
							<span className="ml-1 font-medium text-[14px] text-text-muted">{stat.unit}</span>
						)}
					</span>
					{stat.detail === undefined || stat.detail === null || props.compact ? null : (
						<span
							className={clsx(
								"text-[13px]",
								stat.tone === "success" && "text-success",
								stat.tone === "accent" && "text-accent-text",
								stat.tone === undefined && "text-text-muted",
							)}
						>
							{stat.detail}
						</span>
					)}
				</div>
			))}
		</section>
	);
}

const segmentTone = (segment: TimelineSegment, index: number) => {
	if (segment.superset) {
		return "bg-info";
	}
	return index % 2 === 0 ? "bg-chart-seq-4" : "bg-chart-seq-3";
};

function SessionTimeline(props: { readonly timeline: WorkoutTimeline }) {
	const { timeline } = props;
	return (
		<div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-5 font-ui">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold text-[16px] text-text">Session flow</h2>
				<span className="text-[13px] text-text-muted">
					{formatDuration(timeline.workingSeconds)} working · {formatDuration(timeline.restSeconds)}{" "}
					resting
				</span>
			</div>
			<ol className="flex h-10 gap-0.75" aria-label="Exercises over time">
				{timeline.segments.map((segment, index) => (
					<li
						key={segment.key}
						style={{ flexGrow: Math.max(segment.seconds, 1) }}
						title={`${segment.label} · ${formatDuration(segment.seconds)}`}
						className={clsx(
							"flex min-w-0 basis-0 items-center justify-center overflow-hidden rounded-sm px-1 text-[12px] font-semibold whitespace-nowrap text-accent-ink",
							segmentTone(segment, index),
						)}
					>
						<span className="truncate">{segment.label}</span>
					</li>
				))}
			</ol>
		</div>
	);
}

function MusclesWorked(props: {
	readonly muscles: readonly MuscleCount[];
	readonly equipment: readonly { readonly name: string; readonly exercises: number }[];
}) {
	const most = props.muscles[0]?.sets ?? 1;
	return (
		<div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-5 font-ui">
			<div className="flex items-baseline justify-between">
				<h2 className="font-semibold text-[16px] text-text">Muscles worked</h2>
				<span className="text-[13px] text-text-muted">sets</span>
			</div>
			<ul className="grid gap-2">
				{props.muscles.map((muscle) => (
					<li
						key={muscle.name}
						className="grid grid-cols-[6rem_minmax(0,1fr)_2rem] items-center gap-3 text-[14px]"
					>
						<span className="truncate text-text">{muscle.name}</span>
						<span className="h-2 overflow-hidden rounded-pill bg-surface-2">
							<span
								className="block h-full rounded-pill bg-accent"
								style={{ width: `${(muscle.sets / most) * 100}%` }}
							/>
						</span>
						<span className="text-right text-text-muted tabular-nums">{muscle.sets}</span>
					</li>
				))}
			</ul>
			{props.equipment.length === 0 ? null : (
				<p className="border-t border-border pt-3 text-[13px] text-text-muted">
					{props.equipment.map(({ name, exercises }) => `${name} ${exercises}`).join(" · ")}
				</p>
			)}
		</div>
	);
}

export function WorkoutSession(props: {
	readonly compact: boolean;
	readonly timeline: WorkoutTimeline | null;
	readonly muscles: readonly MuscleCount[];
	readonly equipment: readonly { readonly name: string; readonly exercises: number }[];
}) {
	if (props.timeline === null && props.muscles.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="Session"
			className={clsx(
				"grid gap-4",
				!props.compact &&
					props.timeline !== null &&
					props.muscles.length > 0 &&
					"lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
			)}
		>
			{props.timeline === null ? null : <SessionTimeline timeline={props.timeline} />}
			{props.muscles.length === 0 ? null : (
				<MusclesWorked muscles={props.muscles} equipment={props.equipment} />
			)}
		</section>
	);
}

export function WorkoutComment(props: { readonly comment: string | null }) {
	if (props.comment === null || props.comment.trim() === "") {
		return null;
	}
	return (
		<p className="rounded-xl border border-border bg-surface p-4 font-ui text-[15px] text-text">
			{props.comment}
		</p>
	);
}
