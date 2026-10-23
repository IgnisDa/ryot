import { Schema } from "@ryot-app/plugin-kit/effect";

import { NonNegativeInt } from "./fitness-primitives";
import type { WorkoutEditorDisplay, WorkoutEditorLocalPreferences } from "./workout-editor-draft";
import type { WorkoutSetLot } from "./workout-set";
import {
	durationDisplayUnit,
	type DurationUnit,
	DurationUnitSchema,
	type EnergyUnit,
	EnergyUnitSchema,
	type UnitSystem,
	UnitSystemSchema,
} from "./workout-units";

export const workoutRestFields = [
	"dropRestTime",
	"normalRestTime",
	"warmUpRestTime",
	"failureRestTime",
] as const;
export type WorkoutRestField = (typeof workoutRestFields)[number];

const inheritedRestSeconds = Schema.optional(Schema.NullOr(NonNegativeInt));

export const WorkoutRestSettingsSchema = Schema.Struct({
	dropRestTime: NonNegativeInt,
	normalRestTime: NonNegativeInt,
	warmUpRestTime: NonNegativeInt,
	failureRestTime: NonNegativeInt,
});

export const WorkoutExerciseOverridesSchema = Schema.Struct({
	dropRestTime: inheritedRestSeconds,
	normalRestTime: inheritedRestSeconds,
	warmUpRestTime: inheritedRestSeconds,
	failureRestTime: inheritedRestSeconds,
	defaultDurationUnit: Schema.optional(Schema.NullOr(DurationUnitSchema)),
});

export const WorkoutPreferenceSettingsSchema = Schema.Struct({
	...WorkoutRestSettingsSchema.fields,
	muteSounds: Schema.Boolean,
	energyUnit: EnergyUnitSchema,
	unitSystem: UnitSystemSchema,
	promptForRestTimer: Schema.Boolean,
	startTimerForDurationExercises: Schema.Boolean,
	weeklyWorkoutGoal: Schema.optional(Schema.NullOr(Schema.Int)),
});

export type WorkoutRestSettings = typeof WorkoutRestSettingsSchema.Type;
export type WorkoutExerciseOverrides = typeof WorkoutExerciseOverridesSchema.Type;
export type WorkoutPreferenceSettings = typeof WorkoutPreferenceSettingsSchema.Type;

const restFieldBySetLot: Record<WorkoutSetLot, WorkoutRestField> = {
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
	readonly exerciseDurationUnit?: DurationUnit | null | undefined;
	readonly globalEnergyUnit?: EnergyUnit | undefined;
	readonly unitSystem: UnitSystem;
}) => ({
	energyUnit: input.globalEnergyUnit ?? "kcal",
	weightUnit: input.occurrence?.weightUnit ?? (input.unitSystem === "metric" ? "kg" : "lb"),
	durationUnit: durationDisplayUnit(input.occurrence?.durationUnit, input.exerciseDurationUnit),
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
