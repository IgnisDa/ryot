import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import { formatDuration } from "@ryot-app/plugin-ui-sdk";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import { displayMeasure } from "../../shared/workout-units";
import type { FitnessText } from "../messages";
import type { WorkoutSet } from "./details-model";

export type Measure = "reps" | "weight" | "volume" | "distance" | "duration";

export const formatNumber = (formatters: Formatters, value: number) =>
	formatters.number({ maximumFractionDigits: 2 }).format(value);

export type MeasureUnit = "kg" | "lb" | "km" | "mi" | "hr" | "sec" | "min" | "km/h";

const intlUnits = {
	mi: "mile",
	hr: "hour",
	lb: "pound",
	sec: "second",
	min: "minute",
	kg: "kilogram",
	km: "kilometer",
	"km/h": "kilometer-per-hour",
} as const satisfies Record<MeasureUnit, Intl.NumberFormatOptions["unit"]>;

const unitFormat = (
	formatters: Formatters,
	unit: MeasureUnit,
	options: Intl.NumberFormatOptions = { maximumFractionDigits: 2 },
) => formatters.number({ ...options, style: "unit", unitDisplay: "short", unit: intlUnits[unit] });

export const formatUnitValue = (
	formatters: Formatters,
	value: number,
	unit: MeasureUnit,
	options?: Intl.NumberFormatOptions,
) => unitFormat(formatters, unit, options).format(value);

export const formatEnteredUnitValue = (
	formatters: Formatters,
	entered: string,
	unit: MeasureUnit,
) => {
	const value = Number(entered);
	if (Number.isFinite(value)) {
		return formatUnitValue(formatters, value, unit, { maximumFractionDigits: 20 });
	}
	return unitFormat(formatters, unit)
		.formatToParts(0)
		.map((part) => (part.type === "integer" ? entered : part.value))
		.join("");
};

export const formatWeightedVolume = (
	formatters: Formatters,
	text: FitnessText,
	value: number,
	imperial: boolean,
	options?: Intl.NumberFormatOptions,
) =>
	text("common.unit.weighted-volume", {
		weight: formatUnitValue(formatters, value, imperial ? "lb" : "kg", options),
	});

export const displayUnit = (
	text: FitnessText,
	display: { readonly unit: string; readonly weightedVolume: boolean },
) => (display.weightedVolume ? text("common.unit.volume", { unit: display.unit }) : display.unit);

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

export const formatMeasure = (
	formatters: Formatters,
	text: FitnessText,
	value: number,
	measure: Measure,
	imperial = false,
) => {
	if (measure === "duration") {
		return formatDuration(formatters, value);
	}
	if (measure === "reps") {
		return text("client.format.reps", { count: value });
	}
	const display = displayMeasure(measure, value, {
		energyUnit: "kcal",
		unitSystem: imperial ? "imperial" : "metric",
	});
	if (measure === "weight") {
		return formatUnitValue(formatters, display.value, imperial ? "lb" : "kg");
	}
	if (measure === "distance") {
		return formatUnitValue(formatters, display.value, imperial ? "mi" : "km");
	}
	return formatWeightedVolume(formatters, text, display.value, imperial, {
		maximumFractionDigits: 20,
	});
};

export const formatSignedMeasure = (
	formatters: Formatters,
	text: FitnessText,
	value: number,
	measure: Measure,
	imperial = false,
) => {
	if (value === 0) {
		return text("client.format.same-as-last-time");
	}
	const magnitude = formatMeasure(formatters, text, Math.abs(value), measure, imperial);
	return value > 0 ? `+${magnitude}` : `−${magnitude}`;
};

export type SetMeasures = Pick<WorkoutSet, "reps" | "weight" | "distance" | "duration">;

const weightReps = (
	formatters: Formatters,
	text: FitnessText,
	set: SetMeasures,
	imperial: boolean,
) => {
	if (set.weight === null || set.weight === 0) {
		return set.reps === null ? "" : text("client.format.reps", { count: set.reps });
	}
	const weight = formatMeasure(formatters, text, set.weight, "weight", imperial);
	return set.reps === null
		? weight
		: text("client.format.weight-reps", { weight, reps: formatNumber(formatters, set.reps) });
};

export const formatSetMain = (
	formatters: Formatters,
	text: FitnessText,
	kind: null | ExerciseKind,
	set: SetMeasures,
	imperial = false,
	durationUnit?: null | "seconds" | "minutes",
) => {
	const reps = set.reps === null ? null : text("client.format.reps", { count: set.reps });
	let duration: null | string = null;
	if (set.duration !== null) {
		duration = formatDuration(formatters, set.duration);
		if (durationUnit === "seconds") {
			duration = formatUnitValue(formatters, set.duration, "sec");
		}
		if (durationUnit === "minutes") {
			duration = formatUnitValue(formatters, set.duration / 60, "min");
		}
	}
	const distance =
		set.distance === null
			? null
			: formatMeasure(formatters, text, set.distance, "distance", imperial);
	if (kind === "reps_and_weight") {
		return weightReps(formatters, text, set, imperial);
	}
	if (kind === "distance_and_duration") {
		return distance !== null && duration !== null
			? text("client.format.distance-in-duration", { distance, duration })
			: (distance ?? duration ?? "");
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

export const formatLongDate = (formatters: Formatters, value: null | string) => {
	const date = parseDate(value);
	return date === null
		? null
		: formatters
				.dateTime({ month: "long", day: "numeric", year: "numeric", weekday: "long" })
				.format(date);
};

export const formatTimeRange = (
	formatters: Formatters,
	startedAt: null | string,
	endedAt: null | string,
) => {
	const start = parseDate(startedAt);
	const end = parseDate(endedAt);
	if (start === null) {
		return null;
	}
	const time = formatters.dateTime({ hour: "numeric", minute: "2-digit" });
	return end === null ? time.format(start) : time.formatRange(start, end);
};

export const formatShortDate = (
	formatters: Formatters,
	value: string,
	reference: null | string,
) => {
	const date = parseDate(value);
	if (date === null) {
		return value;
	}
	const sameYear = parseDate(reference)?.getFullYear() === date.getFullYear();
	return formatters
		.dateTime({ day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })
		.format(date);
};
