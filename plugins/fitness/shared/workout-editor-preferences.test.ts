import { expect, it } from "vitest";

import {
	resolveWorkoutDisplay,
	resolveWorkoutLocalPreferences,
	resolveWorkoutRestTime,
} from "./workout-editor-preferences";

const settings = { dropRestTime: 0, failureRestTime: 0, normalRestTime: 60, warmUpRestTime: 30 };

it("resolves rest from explicit choice, exercise override, global setting, then default", () => {
	expect(
		resolveWorkoutRestTime({
			settings,
			lot: "normal",
			explicitSeconds: "0",
			overrides: { normalRestTime: 90 },
		}),
	).toEqual({ seconds: 0, kind: "resolved" });
	expect(
		resolveWorkoutRestTime({ settings, lot: "normal", overrides: { normalRestTime: 90 } }),
	).toEqual({ seconds: 90, kind: "resolved" });
	expect(resolveWorkoutRestTime({ settings, overrides: {}, lot: "warm_up" })).toEqual({
		seconds: 30,
		kind: "resolved",
	});
	expect(resolveWorkoutRestTime({ settings: {}, overrides: {}, lot: "failure" })).toEqual({
		seconds: 0,
		kind: "resolved",
	});
	expect(
		resolveWorkoutRestTime({ settings, lot: "normal", overrides: {}, explicitSeconds: "1.5" }),
	).toEqual({ kind: "invalid" });
	expect(
		resolveWorkoutRestTime({ settings, lot: "normal", overrides: {}, explicitSeconds: " " }),
	).toEqual({ kind: "invalid" });
});

it("resolves occurrence display choices before exercise overrides and global units", () => {
	expect(
		resolveWorkoutDisplay({
			unitSystem: "imperial",
			globalEnergyUnit: "kJ",
			exerciseDurationUnit: "seconds",
			occurrence: { weightUnit: "kg", distanceUnit: "km" },
		}),
	).toEqual({ weightUnit: "kg", energyUnit: "kJ", distanceUnit: "km", durationUnit: "seconds" });
	expect(resolveWorkoutDisplay({ unitSystem: "imperial", exerciseDurationUnit: null })).toEqual({
		weightUnit: "lb",
		distanceUnit: "mi",
		energyUnit: "kcal",
		durationUnit: "minutes",
	});
});

it("resolves local sound and timer choices before installation preferences", () => {
	const global = {
		muteSounds: false,
		promptForRestTimer: true,
		startTimerForDurationExercises: true,
	};
	expect(resolveWorkoutLocalPreferences(undefined, global)).toEqual(global);
	expect(
		resolveWorkoutLocalPreferences({ muteSounds: true, promptForRestTimer: false }, global),
	).toEqual({ muteSounds: true, promptForRestTimer: false, startTimerForDurationExercises: true });
});
