import type {
	IosLiveActivityContent,
	IosLiveActivityValue,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import { formatClock } from "@ryot-app/plugin-ui-sdk";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { kilogramsToPounds, poundsToKilograms } from "../../shared/workout-units";
import type { FitnessText } from "../messages";
import { formatEnteredUnitValue, formatUnitValue } from "../workout/format";
import { workoutProgressTarget } from "./actions";
import { isoAt } from "./clock";

const bounded = (text: string, maximum = 96) => text.slice(0, maximum);

export const workoutIosActivityKey = (draft: WorkoutEditorDraft) => `workout:${draft.draftId}`;

const activeValue = (text: FitnessText, draft: WorkoutEditorDraft): IosLiveActivityValue => {
	const label = text("client.timers.active");
	if (draft.activeDurationStartedAt === undefined) {
		return { label, kind: "duration", seconds: draft.activeDuration ?? 0 };
	}
	const startedAt = isoAt(
		Date.parse(draft.activeDurationStartedAt) - (draft.activeDuration ?? 0) * 1000,
	);
	if (startedAt === undefined) {
		return { label, kind: "duration", seconds: draft.activeDuration ?? 0 };
	}
	return { label, startedAt, kind: "elapsed" };
};

const targetDescription = (
	formatters: Formatters,
	text: FitnessText,
	draft: WorkoutEditorDraft,
	names: ReadonlyMap<string, string>,
) => {
	const target = workoutProgressTarget(draft);
	if (target === undefined) {
		return draft.occurrences.length === 0
			? text("client.live.no-exercises")
			: text("client.live.all-completed");
	}
	const { set, occurrence } = target;
	const measurements = [
		set.weight?.trim()
			? formatEnteredUnitValue(formatters, set.weight, occurrence.display?.weightUnit ?? "kg")
			: undefined,
		set.reps?.trim() ? text("client.grid.value-reps", { value: set.reps }) : undefined,
		set.duration?.trim()
			? formatEnteredUnitValue(
					formatters,
					set.duration,
					occurrence.display?.durationUnit === "seconds" ? "sec" : "min",
				)
			: undefined,
		set.distance?.trim()
			? formatEnteredUnitValue(formatters, set.distance, occurrence.display?.distanceUnit ?? "km")
			: undefined,
	]
		.filter((value) => value !== undefined)
		.join(" · ");
	const exercise = names.get(occurrence.exerciseId) ?? text("client.editor.exercise");
	const setNumber = occurrence.sets.indexOf(set) + 1;
	return bounded(
		measurements === ""
			? text("client.live.next", { exercise, set: setNumber })
			: text("client.live.next-with", { exercise, measurements, set: setNumber }),
		160,
	);
};

export const workoutIosActivityContent = (
	formatters: Formatters,
	text: FitnessText,
	draft: WorkoutEditorDraft,
	names: ReadonlyMap<string, string>,
	imperial = false,
): IosLiveActivityContent => {
	const sets = draft.occurrences.flatMap((occurrence) => occurrence.sets);
	const done = sets.filter(({ included }) => included).length;
	const active = activeValue(text, draft);
	const volumeKg = draft.occurrences.reduce(
		(volume, occurrence) =>
			volume +
			occurrence.sets.reduce((sum, set) => {
				const weight = Number(set.weight);
				const reps = Number(set.reps);
				return (
					sum +
					(set.included &&
					Number.isFinite(weight) &&
					Number.isFinite(reps) &&
					weight > 0 &&
					reps > 0
						? reps * (occurrence.display?.weightUnit === "lb" ? poundsToKilograms(weight) : weight)
						: 0)
				);
			}, 0),
		0,
	);
	const finished = draft.endedAt !== undefined || draft.submission !== undefined;
	const status =
		draft.activeDurationStartedAt === undefined
			? text("client.notices.paused-title")
			: text("client.home.draft-live-title");
	const base: IosLiveActivityContent = {
		tone: "accent",
		primary: active,
		icon: "activity",
		status: finished ? text("client.live.unsaved") : status,
		detail: targetDescription(formatters, text, draft, names),
		progress: sets.length === 0 ? undefined : done / sets.length,
		title: bounded(draft.name.trim() || text("client.workouts.column-workout")),
		metrics: [
			{
				label: text("property.sets"),
				value: text("client.wsheets.fraction", { done, total: sets.length }),
			},
			...(volumeKg > 0 && Number.isFinite(volumeKg)
				? [
						{
							label: text("property.volume"),
							value: bounded(
								formatUnitValue(
									formatters,
									imperial ? kilogramsToPounds(volumeKg) : volumeKg,
									imperial ? "lb" : "kg",
									{ maximumFractionDigits: 1 },
								),
							),
						},
					]
				: []),
		],
	};
	if (finished) {
		return { ...base, tone: "warning" };
	}
	const countdown = draft.executionCountdown ?? draft.restCountdown;
	const execution = draft.executionCountdown !== undefined;
	if (countdown !== undefined && (execution || draft.pendingRest === undefined)) {
		const paused = countdown.pausedRemainingSeconds !== undefined;
		const heading = execution ? text("client.live.working") : text("client.live.resting");
		const exercise = names.get(countdown.exerciseId) ?? text("client.editor.exercise");
		return {
			...base,
			icon: "timer",
			secondary: active,
			tone: paused ? "warning" : "accent",
			staleAt: paused ? undefined : countdown.deadline,
			detail: execution ? bounded(exercise, 160) : base.detail,
			staleMessage: execution
				? text("client.live.set-timer-complete")
				: text("client.alerts.title", { timer: "rest" }),
			status: bounded(
				text("client.live.status", {
					heading,
					timer: paused ? "paused" : "running",
					workout: draft.activeDurationStartedAt === undefined ? "paused" : "running",
				}),
			),
			primary: paused
				? { label: heading, kind: "duration", seconds: countdown.pausedRemainingSeconds ?? 0 }
				: {
						label: heading,
						kind: "countdown",
						deadline: countdown.deadline,
						startedAt:
							isoAt(Date.parse(countdown.deadline) - countdown.durationSeconds * 1000) ??
							countdown.deadline,
					},
		};
	}
	if (draft.pendingRest !== undefined) {
		return {
			...base,
			status: bounded(
				text("client.live.rest-prompt", { time: formatClock(draft.pendingRest.seconds) }),
			),
		};
	}
	if (draft.stopwatchStartedAt !== undefined || (draft.pausedStopwatchSeconds ?? 0) > 0) {
		return {
			...base,
			secondary: active,
			primary:
				draft.stopwatchStartedAt === undefined
					? {
							kind: "duration",
							label: text("client.timers.stopwatch"),
							seconds: draft.pausedStopwatchSeconds ?? 0,
						}
					: {
							kind: "elapsed",
							label: text("client.timers.stopwatch"),
							startedAt:
								isoAt(
									Date.parse(draft.stopwatchStartedAt) - (draft.pausedStopwatchSeconds ?? 0) * 1000,
								) ?? draft.stopwatchStartedAt,
						},
		};
	}
	return base;
};

export const savedWorkoutIosActivityContent = (
	formatters: Formatters,
	text: FitnessText,
	draft: WorkoutEditorDraft,
	names: ReadonlyMap<string, string>,
	imperial = false,
): IosLiveActivityContent => ({
	...workoutIosActivityContent(formatters, text, draft, names, imperial),
	tone: "success",
	detail: undefined,
	secondary: undefined,
	status: text("client.notices.workout-saved"),
	primary: {
		kind: "duration",
		seconds: draft.activeDuration ?? 0,
		label: text("client.timers.active"),
	},
});
