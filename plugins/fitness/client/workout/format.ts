import type { ExerciseKind } from "../../shared/exercise-kinds";
import { kilogramsToPounds, kilometersToMiles } from "../../shared/workout-units";
import type { MeasureUnit, WorkoutSet } from "./details-model";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const formatNumber = (value: number) => numberFormat.format(value);

const pad = (value: number) => String(value).padStart(2, "0");

export const formatClock = (seconds: number) => {
	const whole = Math.round(seconds);
	return `${Math.floor(whole / 60)}:${pad(whole % 60)}`;
};

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

export const formatMeasure = (value: number, unit: MeasureUnit, imperial = false) => {
	if (unit === "seconds") {
		return formatDuration(value);
	}
	if (imperial && unit === "kg") {
		return `${formatNumber(kilogramsToPounds(value))} lb`;
	}
	if (imperial && unit === "km") {
		return `${formatNumber(kilometersToMiles(value))} mi`;
	}
	return unit === "reps" ? `${formatNumber(value)} reps` : `${formatNumber(value)} ${unit}`;
};

export const formatSignedMeasure = (value: number, unit: MeasureUnit, imperial = false) => {
	if (value === 0) {
		return "Same as last time";
	}
	const magnitude = formatMeasure(Math.abs(value), unit, imperial);
	return value > 0 ? `+${magnitude}` : `−${magnitude}`;
};

export type SetMeasures = Pick<WorkoutSet, "distance" | "duration" | "reps" | "weight">;

const weightReps = (set: SetMeasures, imperial: boolean) => {
	if (set.weight === null || set.weight === 0) {
		return set.reps === null ? "" : `${formatNumber(set.reps)} reps`;
	}
	return `${formatMeasure(set.weight, "kg", imperial)}${set.reps === null ? "" : ` × ${formatNumber(set.reps)}`}`;
};

export const formatSetMain = (
	kind: ExerciseKind | null,
	set: SetMeasures,
	imperial = false,
	durationUnit?: "seconds" | "minutes" | null,
) => {
	const reps = set.reps === null ? null : `${formatNumber(set.reps)} reps`;
	let duration: string | null = null;
	if (set.duration !== null) {
		duration = formatDuration(set.duration);
		if (durationUnit === "seconds") {
			duration = `${formatNumber(set.duration)} s`;
		}
		if (durationUnit === "minutes") {
			duration = `${formatNumber(set.duration / 60)} min`;
		}
	}
	const distance = set.distance === null ? null : formatMeasure(set.distance, "km", imperial);
	if (kind === "reps_and_weight") {
		return weightReps(set, imperial);
	}
	if (kind === "distance_and_duration") {
		return [distance, duration].filter((part) => part !== null).join(" in ");
	}
	return [distance, reps, duration].filter((part) => part !== null).join(" · ");
};

export const parseDate = (value: string | null) => {
	if (value === null) {
		return null;
	}
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : null;
};

export const formatLongDate = (value: string | null) => {
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

export const formatTimeRange = (startedAt: string | null, endedAt: string | null) => {
	const start = parseDate(startedAt);
	const end = parseDate(endedAt);
	if (start === null) {
		return null;
	}
	const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
	return end === null ? time.format(start) : time.formatRange(start, end);
};

export const formatShortDate = (value: string, reference: string | null) => {
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
