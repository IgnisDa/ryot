import { Schema } from "@ryot-app/plugin-kit/effect";

import type { WorkoutEditorDisplay, WorkoutEditorLocalPreferences } from "./workout-editor-draft";
import type { WorkoutSetLot } from "./workout-set";

const restSeconds = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const nullableRestSeconds = Schema.NullOr(restSeconds);

export const WorkoutRestSettingsSchema = Schema.Struct({
	dropRestTime: restSeconds,
	normalRestTime: restSeconds,
	warmUpRestTime: restSeconds,
	failureRestTime: restSeconds,
});

export const WorkoutExerciseOverridesSchema = Schema.Struct({
	dropRestTime: Schema.optional(nullableRestSeconds),
	normalRestTime: Schema.optional(nullableRestSeconds),
	warmUpRestTime: Schema.optional(nullableRestSeconds),
	failureRestTime: Schema.optional(nullableRestSeconds),
	defaultDurationUnit: Schema.optional(Schema.NullOr(Schema.Literals(["seconds", "minutes"]))),
});

export const WorkoutPreferenceSettingsSchema = Schema.Struct({
	...WorkoutRestSettingsSchema.fields,
	muteSounds: Schema.Boolean,
	promptForRestTimer: Schema.Boolean,
	energyUnit: Schema.Literals(["kcal", "kJ"]),
	startTimerForDurationExercises: Schema.Boolean,
	unitSystem: Schema.Literals(["metric", "imperial"]),
});

export type WorkoutRestSettings = typeof WorkoutRestSettingsSchema.Type;
export type WorkoutExerciseOverrides = typeof WorkoutExerciseOverridesSchema.Type;
export type WorkoutPreferenceSettings = typeof WorkoutPreferenceSettingsSchema.Type;

const restFieldBySetLot: Record<WorkoutSetLot, keyof WorkoutRestSettings> = {
	drop: "dropRestTime",
	normal: "normalRestTime",
	warm_up: "warmUpRestTime",
	failure: "failureRestTime",
};

const defaultRestSeconds: WorkoutRestSettings = {
	dropRestTime: 0,
	warmUpRestTime: 0,
	failureRestTime: 0,
	normalRestTime: 60,
};

export const resolveWorkoutRestTime = (input: {
	readonly explicitSeconds?: string | undefined;
	readonly lot: WorkoutSetLot;
	readonly overrides: WorkoutExerciseOverrides;
	readonly settings: Partial<WorkoutRestSettings>;
}): { readonly kind: "invalid" } | { readonly kind: "resolved"; readonly seconds: number } => {
	if (input.explicitSeconds !== undefined) {
		if (input.explicitSeconds.trim() === "") {
			return { kind: "invalid" };
		}
		const seconds = Number(input.explicitSeconds.trim());
		return Number.isSafeInteger(seconds) && seconds >= 0
			? { seconds, kind: "resolved" }
			: { kind: "invalid" };
	}
	const field = restFieldBySetLot[input.lot];
	return {
		kind: "resolved",
		seconds: input.overrides[field] ?? input.settings[field] ?? defaultRestSeconds[field],
	};
};

export const resolveWorkoutDisplay = (input: {
	readonly occurrence?: Partial<WorkoutEditorDisplay> | undefined;
	readonly exerciseDurationUnit?: "seconds" | "minutes" | null | undefined;
	readonly globalEnergyUnit?: "kcal" | "kJ" | undefined;
	readonly unitSystem: "metric" | "imperial";
}) => ({
	energyUnit: input.globalEnergyUnit ?? "kcal",
	durationUnit: input.occurrence?.durationUnit ?? input.exerciseDurationUnit ?? "minutes",
	weightUnit: input.occurrence?.weightUnit ?? (input.unitSystem === "metric" ? "kg" : "lb"),
	distanceUnit: input.occurrence?.distanceUnit ?? (input.unitSystem === "metric" ? "km" : "mi"),
});

export const resolveWorkoutLocalPreferences = (
	local: WorkoutEditorLocalPreferences | undefined,
	global: Pick<
		WorkoutPreferenceSettings,
		"muteSounds" | "promptForRestTimer" | "startTimerForDurationExercises"
	>,
) => ({
	muteSounds: local?.muteSounds ?? global.muteSounds,
	promptForRestTimer: local?.promptForRestTimer ?? global.promptForRestTimer,
	startTimerForDurationExercises:
		local?.startTimerForDurationExercises ?? global.startTimerForDurationExercises,
});
