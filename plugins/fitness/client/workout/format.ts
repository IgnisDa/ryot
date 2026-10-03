import type { ExerciseKind } from "../../shared/exercise-kinds";
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

export const formatMeasure = (value: number, unit: MeasureUnit) => {
	if (unit === "seconds") {
		return formatDuration(value);
	}
	return unit === "reps" ? `${formatNumber(value)} reps` : `${formatNumber(value)} ${unit}`;
};

export const formatSignedMeasure = (value: number, unit: MeasureUnit) => {
	if (value === 0) {
		return "Same as last time";
	}
	const magnitude = formatMeasure(Math.abs(value), unit);
	return value > 0 ? `+${magnitude}` : `−${magnitude}`;
};

const weightReps = (set: WorkoutSet) =>
	set.weight === null || set.weight === 0
		? `${formatNumber(set.reps ?? 0)} reps`
		: `${formatNumber(set.weight)} kg × ${formatNumber(set.reps ?? 0)}`;

export const formatSetMain = (kind: ExerciseKind | null, set: WorkoutSet) => {
	const reps = set.reps === null ? null : `${formatNumber(set.reps)} reps`;
	const duration = set.duration === null ? null : formatDuration(set.duration);
	const distance = set.distance === null ? null : `${formatNumber(set.distance)} km`;
	if (kind === "reps_and_weight") {
		return weightReps(set);
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
