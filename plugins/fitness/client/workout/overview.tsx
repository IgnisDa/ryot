import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import {
	type Formatters,
	type Text,
	useFormatters,
	useHostScreen,
	useRyot,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, formatDuration } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { useState } from "react";

import type { MuscleCount } from "../../shared/fitness-metrics";
import type { WorkoutDetails } from "../../shared/workout-details-recipes";
import { fitnessRoute } from "../../shared/workout-editor-routes";
import { displayMeasure, type EnergyUnit } from "../../shared/workout-units";
import { DeleteFitnessEntity } from "../entity-delete";
import { HeaderActionsMenu } from "../header-actions-menu";
import { type FitnessText, useFitnessMessages } from "../messages";
import { ProcessingNote } from "../workout-processing";
import { countLabel } from "../workouts/model";
import { AdjustWorkoutTime } from "./adjust-time";
import {
	segmentLabel,
	type TimelineSegment,
	type WorkoutSummary,
	type WorkoutTimeline,
} from "./details-model";
import {
	displayUnit,
	formatLongDate,
	formatNumber,
	formatShortDate,
	formatSignedMeasure,
	formatTimeRange,
} from "./format";

type Stat = {
	readonly label: Text;
	readonly value: string;
	readonly unit?: string | undefined;
	readonly detail?: null | string | undefined;
	readonly tone?: "accent" | "success" | undefined;
};

export function WorkoutHeader(props: {
	readonly compact: boolean;
	readonly proAvailable: boolean;
	readonly workout: WorkoutDetails;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { workout } = props;
	const date = formatLongDate(formatters, workout.startedAt);
	const time = formatTimeRange(formatters, workout.startedAt, workout.endedAt);
	return (
		<header
			className={clsx(
				"flex gap-4",
				props.compact ? "flex-col" : "flex-row flex-wrap items-end justify-between",
			)}
		>
			<div className="flex min-w-0 flex-col gap-2">
				<span className="font-ui font-semibold text-[13px] tracking-wide text-accent-text uppercase">
					{text("client.workouts.column-workout")}
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
						kind="repeated"
						workoutStartedAt={workout.startedAt}
						linked={workout.repeatedFrom.items[0]}
					/>
					<LinkedWorkout
						kind="template"
						linked={workout.template.items[0]}
						workoutStartedAt={workout.startedAt}
					/>
				</p>
			</div>
			<WorkoutActions
				name={workout.name}
				entityId={workout.id}
				compact={props.compact}
				proAvailable={props.proAvailable}
			/>
		</header>
	);
}

function LinkedWorkout(props: {
	readonly kind: "repeated" | "template";
	readonly workoutStartedAt: null | string;
	readonly linked:
		undefined | { readonly id: string; readonly name: string; readonly startedAt?: null | string };
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	if (props.linked === undefined) {
		return null;
	}
	const date =
		props.linked.startedAt === undefined || props.linked.startedAt === null
			? null
			: formatShortDate(formatters, props.linked.startedAt, props.workoutStartedAt);
	return (
		<PluginLink className="text-accent-text" to={{ kind: "entity", entityId: props.linked.id }}>
			{date === null
				? text("client.workout.linked", { kind: props.kind, name: props.linked.name })
				: text("client.workout.linked-dated", { date, kind: props.kind, name: props.linked.name })}
		</PluginLink>
	);
}

function WorkoutActions(props: {
	readonly name: string;
	readonly compact: boolean;
	readonly entityId: string;
	readonly proAvailable: boolean;
}) {
	const text = useFitnessMessages();
	const client = useRyot();
	const [adjustingTime, setAdjustingTime] = useState(false);
	const [action, setAction] = useState<"delete">();
	const openScreen = useHostScreen();
	const openEditor = (editorAction: string) => () => {
		client.navigation.push(
			fitnessRoute(`/workouts/${encodeURIComponent(props.entityId)}/${editorAction}`),
		);
	};
	return (
		<div className={clsx("flex gap-2", props.compact && "w-full")}>
			<Button onClick={openEditor("repeat")} className={clsx(props.compact && "flex-1")}>
				{text("client.workout.repeat")}
			</Button>
			<Button variant="secondary" onClick={openEditor("edit")}>
				{text("common.action.edit")}
			</Button>
			<HeaderActionsMenu
				entityId={props.entityId}
				label={text("client.workout.more-actions")}
				items={[
					{
						key: "adjust-time",
						onSelect: () => setAdjustingTime(true),
						label: text("client.workout.adjust-time"),
					},
					{
						key: "create-template",
						onSelect: openEditor("create-template"),
						label: text("client.workout.create-template", {
							pro: props.proAvailable ? "yes" : "no",
						}),
					},
					{
						key: "collections",
						label: text("client.exercise.add-to-collection"),
						onSelect: () =>
							openScreen(client.screens.addToCollection({ entityId: props.entityId })),
					},
					{
						key: "delete",
						destructive: true,
						onSelect: () => setAction("delete"),
						label: text("client.workout.delete"),
					},
				]}
			/>
			{adjustingTime ? (
				<AdjustWorkoutTime entityId={props.entityId} onClose={() => setAdjustingTime(false)} />
			) : null}
			{action === "delete" ? (
				<DeleteFitnessEntity
					kind="workout"
					name={props.name}
					entityId={props.entityId}
					onClose={() => setAction(undefined)}
				/>
			) : null}
		</div>
	);
}

const displayedStat = (
	formatters: Formatters,
	text: FitnessText,
	display: { readonly unit: string; readonly value: number; readonly weightedVolume: boolean },
) => ({ unit: displayUnit(text, display), value: formatNumber(formatters, display.value) });

const summaryStats = (
	formatters: Formatters,
	text: FitnessText,
	workout: WorkoutDetails,
	summary: WorkoutSummary,
	imperial: boolean,
	energyUnit: EnergyUnit,
) => {
	const preferences = { energyUnit, unitSystem: imperial ? "imperial" : "metric" } as const;
	const stats: ReadonlyArray<Stat | null> = [
		{
			label: text("client.workout.active-duration"),
			value:
				workout.activeDuration === null
					? text("client.editor.stat.unknown")
					: formatDuration(formatters, workout.activeDuration),
		},
		summary.durationSeconds === null
			? null
			: {
					label: text("client.workout.elapsed-duration"),
					value: formatDuration(formatters, summary.durationSeconds),
					detail: formatTimeRange(formatters, workout.startedAt, workout.endedAt),
				},
		summary.volume !== null && summary.volume > 0
			? {
					label: text("property.volume"),
					...displayedStat(formatters, text, displayMeasure("volume", summary.volume, preferences)),
					tone: summary.volumeDelta !== null && summary.volumeDelta > 0 ? "success" : undefined,
					detail:
						summary.volumeDelta === null
							? null
							: text("client.workout.vs-previous", {
									change: formatSignedMeasure(
										formatters,
										text,
										summary.volumeDelta,
										"volume",
										imperial,
									),
								}),
				}
			: null,
		{
			label: text("property.sets"),
			value: formatNumber(formatters, summary.sets),
			detail: countLabel(text, "exercise", summary.exercises),
		},
		summary.reps > 0
			? { label: text("property.reps"), value: formatNumber(formatters, summary.reps) }
			: null,
		summary.restSeconds > 0
			? {
					label: text("property.planned-rest"),
					value: formatDuration(formatters, summary.restSeconds),
				}
			: null,
		summary.records !== null && summary.records > 0
			? {
					tone: "accent",
					label: text("client.workouts.summary.awards"),
					value: formatNumber(formatters, summary.records),
					detail: text("client.workout.across-sets", { count: summary.recordSets ?? 0 }),
				}
			: null,
		workout.caloriesBurnt !== null && workout.caloriesBurnt >= 0
			? {
					label: text("client.workout.energy"),
					...displayedStat(
						formatters,
						text,
						displayMeasure("energy", workout.caloriesBurnt, preferences),
					),
				}
			: null,
	];
	return stats.filter((stat) => stat !== null);
};

export function WorkoutSummaryRow(props: {
	readonly compact: boolean;
	readonly imperial: boolean;
	readonly energyUnit: EnergyUnit;
	readonly summary: WorkoutSummary;
	readonly workout: WorkoutDetails;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	return (
		<section
			aria-label={text("client.workouts.summary.label")}
			className={clsx(
				"grid gap-px overflow-hidden rounded-lg border border-border-card bg-border",
				props.compact ? "grid-cols-3" : "grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]",
			)}
		>
			{summaryStats(
				formatters,
				text,
				props.workout,
				props.summary,
				props.imperial,
				props.energyUnit,
			).map((stat) => (
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
			<ProcessingNote />
		</section>
	);
}

const segmentTone = (segment: TimelineSegment, index: number) => {
	if (segment.superset) {
		return "bg-info text-surface";
	}
	return index % 2 === 0 ? "bg-chart-seq-4 text-accent-ink" : "bg-chart-seq-3 text-accent-ink";
};

export function WorkoutComment(props: { readonly comment: null | string }) {
	if (props.comment === null || props.comment.trim() === "") {
		return null;
	}
	return <Card className="font-ui text-[15px] whitespace-pre-wrap text-text">{props.comment}</Card>;
}

export function WorkoutSession(props: {
	readonly compact: boolean;
	readonly muscles: readonly MuscleCount[];
	readonly timeline: null | WorkoutTimeline;
	readonly equipment: readonly { readonly name: string; readonly exercises: number }[];
}) {
	const text = useFitnessMessages();
	if (props.timeline === null && props.muscles.length === 0) {
		return null;
	}
	return (
		<section
			aria-label={text("client.workout.session")}
			className={clsx(
				"grid gap-4",
				!props.compact &&
					props.timeline !== null &&
					props.muscles.length > 0 &&
					"grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
			)}
		>
			{props.timeline === null ? null : <SessionTimeline timeline={props.timeline} />}
			{props.muscles.length === 0 ? null : (
				<MusclesWorked muscles={props.muscles} equipment={props.equipment} />
			)}
		</section>
	);
}

function SessionTimeline(props: { readonly timeline: WorkoutTimeline }) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { timeline } = props;
	return (
		<Card padding="lg" className="flex min-w-0 flex-col gap-3 font-ui">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold text-[16px] text-text">
					{text("client.workout.session-flow")}
				</h2>
				<span className="text-[13px] text-text-muted">
					{text("client.workout.rest-total", {
						duration: formatDuration(formatters, timeline.restSeconds),
					})}
				</span>
			</div>
			<ol className="flex h-10 gap-0.75" aria-label={text("client.workout.exercises-over-time")}>
				{timeline.segments.map((segment, index) => (
					<li
						key={segment.key}
						style={{ flexGrow: Math.max(segment.seconds, 1) }}
						title={text("client.workout.segment-title", {
							label: segmentLabel(text, segment),
							duration: formatDuration(formatters, segment.seconds),
						})}
						className={clsx(
							"flex min-w-0 basis-0 items-center justify-center overflow-hidden rounded-sm px-1 text-[12px] font-semibold whitespace-nowrap",
							segmentTone(segment, index),
						)}
					>
						<span className="truncate">{segmentLabel(text, segment)}</span>
					</li>
				))}
			</ol>
		</Card>
	);
}

function MusclesWorked(props: {
	readonly muscles: readonly MuscleCount[];
	readonly equipment: readonly { readonly name: string; readonly exercises: number }[];
}) {
	const text = useFitnessMessages();
	const most = props.muscles[0]?.sets ?? 1;
	return (
		<Card padding="lg" className="flex min-w-0 flex-col gap-3 font-ui">
			<div className="flex items-baseline justify-between">
				<h2 className="font-semibold text-[16px] text-text">
					{text("client.exercise.muscles-worked")}
				</h2>
				<span className="text-[13px] text-text-muted">{text("client.workout.weighted-sets")}</span>
			</div>
			<ul className="grid gap-2">
				{props.muscles.map((muscle) => (
					<li
						key={muscle.id}
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
					{props.equipment
						.map(({ name, exercises }) =>
							text("client.workout.equipment-occurrences", { name, count: exercises }),
						)
						.join(" · ")}
				</p>
			)}
		</Card>
	);
}
