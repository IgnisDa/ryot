import { clockFormat } from "@ryot-app/plugin-ui-sdk";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import { displayMeasure } from "../../shared/workout-units";
import type { WorkoutSet } from "./details-model";

export type Measure = "reps" | "weight" | "volume" | "distance" | "duration";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });

export const formatNumber = (value: number) => numberFormat.format(value);

export const formatClock = (seconds: number) => clockFormat.format(Math.round(seconds));

export const formatDuration = (seconds: number) => {
	const whole = Math.round(seconds);
	if (whole < 60) {
		return `${whole} s`;
	}
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	if (hours > 0) {
		return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	}
	return whole % 60 === 0 ? `${minutes} min` : formatClock(whole);
};

export const formatExerciseMeta = (exercise: {
	readonly equipment: readonly { readonly name: string }[];
	readonly targets: readonly { readonly name: string; readonly role: null | string }[];
}) =>
	[
		...exercise.targets
			.filter((target) => target.role === null || target.role === "primary")
			.map((target) => target.name),
		...exercise.equipment.map((equipment) => equipment.name),
	].join(" · ");

export const formatMeasure = (value: number, measure: Measure, imperial = false) => {
	if (measure === "duration") {
		return formatDuration(value);
	}
	if (measure === "reps") {
		return `${formatNumber(value)} reps`;
	}
	const display = displayMeasure(measure, value, {
		energyUnit: "kcal",
		unitSystem: imperial ? "imperial" : "metric",
	});
	const formatted =
		measure === "volume" ? volumeFormat.format(display.value) : formatNumber(display.value);
	return `${formatted} ${display.unit}`;
};

export const formatSignedMeasure = (value: number, measure: Measure, imperial = false) => {
	if (value === 0) {
		return "Same as last time";
	}
	const magnitude = formatMeasure(Math.abs(value), measure, imperial);
	return value > 0 ? `+${magnitude}` : `−${magnitude}`;
};

export type SetMeasures = Pick<WorkoutSet, "reps" | "weight" | "distance" | "duration">;

const weightReps = (set: SetMeasures, imperial: boolean) => {
	if (set.weight === null || set.weight === 0) {
		return set.reps === null ? "" : `${formatNumber(set.reps)} reps`;
	}
	return `${formatMeasure(set.weight, "weight", imperial)}${set.reps === null ? "" : ` × ${formatNumber(set.reps)}`}`;
};

export const formatSetMain = (
	kind: null | ExerciseKind,
	set: SetMeasures,
	imperial = false,
	durationUnit?: null | "seconds" | "minutes",
) => {
	const reps = set.reps === null ? null : `${formatNumber(set.reps)} reps`;
	let duration: null | string = null;
	if (set.duration !== null) {
		duration = formatDuration(set.duration);
		if (durationUnit === "seconds") {
			duration = `${formatNumber(set.duration)} s`;
		}
		if (durationUnit === "minutes") {
			duration = `${formatNumber(set.duration / 60)} min`;
		}
	}
	const distance = set.distance === null ? null : formatMeasure(set.distance, "distance", imperial);
	if (kind === "reps_and_weight") {
		return weightReps(set, imperial);
	}
	if (kind === "distance_and_duration") {
		return [distance, duration].filter((part) => part !== null).join(" in ");
	}
	return [distance, reps, duration].filter((part) => part !== null).join(" · ");
};

export const parseDate = (value: null | string) => {
	if (value === null) {
		return null;
	}
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : null;
};

export const formatLongDate = (value: null | string) => {
	const date = parseDate(value);
	return date === null
		? null
		: new Intl.DateTimeFormat("en-US", {
				month: "long",
				day: "numeric",
				year: "numeric",
				weekday: "long",
			}).format(date);
};

export const formatTimeRange = (startedAt: null | string, endedAt: null | string) => {
	const start = parseDate(startedAt);
	const end = parseDate(endedAt);
	if (start === null) {
		return null;
	}
	const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
	return end === null ? time.format(start) : time.formatRange(start, end);
};

export const formatShortDate = (value: string, reference: null | string) => {
	const date = parseDate(value);
	if (date === null) {
		return value;
	}
	const sameYear = parseDate(reference)?.getFullYear() === date.getFullYear();
	return new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	}).format(date);
};
