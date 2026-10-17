import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Card } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import { fitnessRoute } from "../../shared/workout-editor-routes";
import type { WorkoutSummary } from "../../shared/workout-list-recipes";
import type { ActiveEditorDraft } from "../exercise/active-draft";
import { workoutEditorContextQuery } from "../workout-editor/context-query";
import { summaryWindows, type WorkoutCard } from "../workouts/model";
import { workoutSummaryQuery } from "../workouts/queries";
import { buildWeekProgress, draftBanner } from "./model";
import {
	Chips,
	HomeCard,
	QueryBody,
	goalPreferencesTarget,
	linkClass,
	secondaryLinkClass,
} from "./section";

export function ResumeBanner(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly draft: ActiveEditorDraft;
}) {
	const client = useRyot();
	const banner = draftBanner(props.draft, props.now, props.timeZone);
	return (
		<section
			aria-label={banner.title}
			className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent bg-accent-soft p-4 font-ui"
		>
			<div className="flex min-w-0 items-center gap-3">
				<span
					aria-hidden="true"
					className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink"
				>
					<AppIcon size={16} name="play" />
				</span>
				<div className="min-w-0">
					<p className="text-[12.5px] text-text-muted">{banner.title}</p>
					<p className="truncate text-[15px] font-semibold text-text">{props.draft.name}</p>
					<p className="text-[12.5px] text-text-muted tabular-nums">{banner.detail}</p>
				</div>
			</div>
			<Button onClick={() => client.navigation.push(fitnessRoute("/workout-editor"))}>
				Resume
			</Button>
		</section>
	);
}

export function SetGoalCard() {
	return (
		<HomeCard label="Weekly goal" title="Set a weekly goal">
			<p className="text-[13px] text-text-muted">
				Pick how many workouts you aim for each week, and Home tracks how often you hit it.
			</p>
			<PluginLink to={goalPreferencesTarget} className={clsx(secondaryLinkClass, "self-start")}>
				Choose a goal
			</PluginLink>
		</HomeCard>
	);
}

export function WeekGoalSection(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly hasLiveDraft: boolean;
}) {
	const { now, timeZone } = props;
	const context = useRyotQuery(workoutEditorContextQuery);
	const summary = useRyotQuery(workoutSummaryQuery, { timeZone, ...summaryWindows("7D", now) });
	const goal = context.data?.settings.weeklyWorkoutGoal ?? undefined;
	if (context.data !== undefined && goal === undefined) {
		return <SetGoalCard />;
	}
	if (goal === undefined || summary.data === undefined) {
		return (
			<HomeCard title="This week" label="Weekly goal">
				{context.data === undefined ? (
					<QueryBody result={context} noun="weekly goal">
						{() => null}
					</QueryBody>
				) : (
					<QueryBody result={summary} noun="weekly goal">
						{() => null}
					</QueryBody>
				)}
			</HomeCard>
		);
	}
	return (
		<WeekGoalCard
			now={now}
			goal={goal}
			timeZone={timeZone}
			summary={summary.data}
			hasLiveDraft={props.hasLiveDraft}
		/>
	);
}

function WeekGoalCard(props: {
	readonly now: Date;
	readonly goal: number;
	readonly timeZone: string;
	readonly summary: WorkoutSummary;
	readonly hasLiveDraft: boolean;
}) {
	const { now, goal, summary, timeZone } = props;
	const week = buildWeekProgress({ now, goal, summary, timeZone });
	return (
		<HomeCard
			title="This week"
			label="Weekly goal"
			link={
				<PluginLink className={linkClass} to={goalPreferencesTarget}>
					Edit goal
				</PluginLink>
			}
		>
			<p className="flex items-baseline gap-2">
				<span className="text-[34px] leading-none font-semibold text-text tabular-nums">
					{week.done}
				</span>
				<span className="text-[13px] text-text-muted">of {goal} workouts</span>
			</p>
			<div className="grid grid-cols-7 gap-1.5">
				{week.days.map((day) => (
					<div key={day.key} className="flex flex-col items-center gap-1">
						<span
							className={clsx(
								"h-7 w-full rounded-md",
								day.trained ? "bg-chart-seq-4" : "bg-surface-2",
								day.isToday &&
									!day.trained &&
									"border-2 border-dashed border-border-emphasis bg-surface",
								day.isToday && props.hasLiveDraft && "border-2 border-solid border-accent",
							)}
						/>
						<span
							className={clsx(
								"text-[11px] text-text-subtle",
								day.isToday && "font-semibold text-text",
							)}
						>
							{day.label}
						</span>
					</div>
				))}
			</div>
			<div className="flex items-end justify-between gap-3">
				<div className="flex flex-col gap-0.5 text-[12.5px] text-text-muted">
					{week.streak > 1 ? <span className="text-success">{week.streak}-week streak</span> : null}
					<span>Goal met {week.goalMet} of last 8 weeks</span>
				</div>
				<div
					role="img"
					className="flex h-10 items-end gap-1"
					aria-label={`Workouts per week, last 8 weeks: ${week.recent.map(({ count }) => count).join(", ")}`}
				>
					{week.recent.map(({ key, count, metGoal }) => (
						<span
							key={key}
							style={{ height: `${Math.max(4, (count / week.peak) * 40)}px` }}
							className={clsx("w-2 rounded-xs", metGoal ? "bg-accent" : "bg-surface-3")}
						/>
					))}
				</div>
			</div>
		</HomeCard>
	);
}

export function LastWorkoutCard(props: { readonly card: WorkoutCard }) {
	const { card } = props;
	return (
		<HomeCard
			title="Last workout"
			label="Last workout"
			link={
				<PluginLink className={linkClass} to={{ kind: "entity", entityId: card.id }}>
					View
				</PluginLink>
			}
		>
			<div className="flex flex-col gap-0.5">
				<span className="text-[17px] font-semibold text-text">{card.name}</span>
				<span className="text-[12.5px] text-text-muted">
					{[card.day, card.time].filter((part) => part !== null).join(" · ")}
				</span>
			</div>
			<div className="grid grid-cols-3 gap-2 text-text tabular-nums">
				<Stat value={card.duration?.value ?? "—"} label={card.duration?.label ?? "Duration"} />
				<Stat label="Volume" value={card.volume ?? "—"} />
				<Stat
					value={String(card.sets)}
					label={`Sets · ${card.exercises} ${card.exercises === 1 ? "exercise" : "exercises"}`}
				/>
			</div>
			{card.muscles.length === 0 ? null : <Chips names={card.muscles} more={card.moreMuscles} />}
			<div className="flex flex-wrap gap-2">
				<PluginLink
					className={secondaryLinkClass}
					to={fitnessRoute(`/workouts/${encodeURIComponent(card.id)}/repeat`)}
				>
					<AppIcon size={14} name="rotate-ccw" />
					Repeat
				</PluginLink>
				<PluginLink
					className={secondaryLinkClass}
					to={fitnessRoute(`/workouts/${encodeURIComponent(card.id)}/create-template`)}
				>
					Save as template
				</PluginLink>
			</div>
		</HomeCard>
	);
}

function Stat(props: { readonly value: string; readonly label: string }) {
	return (
		<Card padding="none" className="flex min-w-0 flex-col gap-0.5 bg-surface-2 px-3 py-2">
			<span className="truncate text-[15px] font-semibold">{props.value}</span>
			<span className="text-[11.5px] text-text-muted">{props.label}</span>
		</Card>
	);
}
