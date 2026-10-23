import type {
	IosLiveActivityContent,
	IosLiveActivityValue,
} from "@ryot-app/plugin-client-sdk/plugin";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { kilogramsToPounds, poundsToKilograms } from "../../shared/workout-units";
import { workoutProgressTarget } from "./actions";
import { formatEditorSeconds, isoAt } from "./clock";

const bounded = (text: string, maximum = 96) => text.slice(0, maximum);

export const workoutIosActivityKey = (draft: WorkoutEditorDraft) => `workout:${draft.draftId}`;

const activeValue = (draft: WorkoutEditorDraft): IosLiveActivityValue => {
	const label = "Active";
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

const targetDescription = (draft: WorkoutEditorDraft, names: ReadonlyMap<string, string>) => {
	const target = workoutProgressTarget(draft);
	if (target === undefined) {
		return draft.occurrences.length === 0 ? "No exercises added" : "All sets completed";
	}
	const { set, occurrence } = target;
	const measurements = [
		set.weight?.trim() ? `${set.weight} ${occurrence.display?.weightUnit ?? "kg"}` : undefined,
		set.reps?.trim() ? `${set.reps} reps` : undefined,
		set.duration?.trim()
			? `${set.duration} ${occurrence.display?.durationUnit === "seconds" ? "sec" : "min"}`
			: undefined,
		set.distance?.trim()
			? `${set.distance} ${occurrence.display?.distanceUnit ?? "km"}`
			: undefined,
	]
		.filter((value) => value !== undefined)
		.join(" · ");
	return bounded(
		`Next: ${names.get(occurrence.exerciseId) ?? "Exercise"} · Set ${occurrence.sets.indexOf(set) + 1}${measurements === "" ? "" : ` · ${measurements}`}`,
		160,
	);
};

export const workoutIosActivityContent = (
	draft: WorkoutEditorDraft,
	names: ReadonlyMap<string, string>,
	imperial = false,
): IosLiveActivityContent => {
	const sets = draft.occurrences.flatMap((occurrence) => occurrence.sets);
	const done = sets.filter(({ included }) => included).length;
	const active = activeValue(draft);
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
		draft.activeDurationStartedAt === undefined ? "Workout paused" : "Workout in progress";
	const base: IosLiveActivityContent = {
		tone: "accent",
		primary: active,
		icon: "activity",
		detail: targetDescription(draft, names),
		title: bounded(draft.name.trim() || "Workout"),
		status: finished ? "Workout not saved yet" : status,
		progress: sets.length === 0 ? undefined : done / sets.length,
		metrics: [
			{ label: "Sets", value: `${done}/${sets.length}` },
			...(volumeKg > 0 && Number.isFinite(volumeKg)
				? [
						{
							label: "Volume",
							value: bounded(
								`${(imperial ? kilogramsToPounds(volumeKg) : volumeKg).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${imperial ? "lb" : "kg"}`,
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
		const heading = execution ? "Working" : "Resting";
		const exercise = names.get(countdown.exerciseId) ?? "Exercise";
		return {
			...base,
			icon: "timer",
			secondary: active,
			tone: paused ? "warning" : "accent",
			staleAt: paused ? undefined : countdown.deadline,
			detail: execution ? bounded(exercise, 160) : base.detail,
			staleMessage: execution ? "Set timer complete" : "Rest complete",
			status: bounded(
				`${heading}${paused ? " · timer paused" : ""}${draft.activeDurationStartedAt === undefined ? " · workout paused" : ""}`,
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
				`Set completed · Rest for ${formatEditorSeconds(draft.pendingRest.seconds)}?`,
			),
		};
	}
	if (draft.stopwatchStartedAt !== undefined || (draft.pausedStopwatchSeconds ?? 0) > 0) {
		return {
			...base,
			secondary: active,
			primary:
				draft.stopwatchStartedAt === undefined
					? { kind: "duration", label: "Stopwatch", seconds: draft.pausedStopwatchSeconds ?? 0 }
					: {
							kind: "elapsed",
							label: "Stopwatch",
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
	draft: WorkoutEditorDraft,
	names: ReadonlyMap<string, string>,
	imperial = false,
): IosLiveActivityContent => ({
	...workoutIosActivityContent(draft, names, imperial),
	tone: "success",
	detail: undefined,
	secondary: undefined,
	status: "Workout saved",
	primary: { label: "Active", kind: "duration", seconds: draft.activeDuration ?? 0 },
});
