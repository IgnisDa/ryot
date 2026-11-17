import {
	calendarDaysBetween,
	localDateOf,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import { formatClock, formatDuration } from "@ryot-app/plugin-ui-sdk";

import {
	bestWeightRepThresholds,
	type ExerciseDetails,
} from "../../shared/exercise-details-recipes";
import type { ExerciseKind } from "../../shared/exercise-kinds";
import type { PersonalBest } from "../../shared/workout-records";
import type { ExerciseLabels, FitnessText } from "../messages";
import { formatNumber, formatUnitValue, formatWeightedVolume, parseDate } from "../workout/format";

export type ExerciseRecord = NonNullable<ExerciseDetails["exercise"]>;
export type PersonalBestRow = ExerciseDetails["personalBests"][number];
type Totals = ExerciseDetails["totals"];
type Month = ExerciseDetails["months"][number];
type SetNote = ExerciseDetails["setNotes"][number];
type Target = ExerciseRecord["targets"]["items"][number];
type WorkoutNoteRow = ExerciseDetails["workoutNotes"][number];

export const isCustomExercise = (exercise: ExerciseRecord) => exercise.userId !== null;

type FactRow = { readonly label: string; readonly value: string };

export const exerciseFacts = (
	formatters: Formatters,
	text: FitnessText,
	labels: ExerciseLabels,
	exercise: ExerciseRecord,
): readonly FactRow[] => {
	const equipment = formatters.list().format(exercise.equipment.items.map((item) => item.name));
	const rows: ReadonlyArray<null | FactRow> = [
		equipment === "" ? null : { value: equipment, label: text("browse.field.equipment") },
		exercise.kind === null
			? null
			: { value: labels.kind(exercise.kind), label: text("client.exercise.fact.tracked-as") },
		exercise.mechanic === null
			? null
			: { label: text("property.mechanic"), value: labels.mechanic(exercise.mechanic) },
		exercise.force === null
			? null
			: { label: text("property.force"), value: labels.force(exercise.force) },
		exercise.level === null
			? null
			: { label: text("property.level"), value: labels.level(exercise.level) },
	];
	return rows.filter((row) => row !== null);
};

type MuscleGroup = {
	readonly primary: boolean;
	readonly label: null | string;
	readonly names: readonly string[];
};

const roleGroups = [
	{ role: "primary", code: "primary" },
	{ role: "secondary", code: "secondary" },
	{ role: "stabilizer", code: "stabilizer" },
	{ role: null, code: "unassigned" },
] as const;

export const groupTargets = (
	text: FitnessText,
	targets: readonly Target[],
): readonly MuscleGroup[] => {
	if (targets.length === 0) {
		return [];
	}
	if (targets.every((target) => target.role === null)) {
		return [{ label: null, primary: false, names: targets.map((target) => target.name) }];
	}
	return roleGroups
		.map(({ role, code }) => ({
			primary: role === "primary",
			label: text("client.exercise.role", { role: code }),
			names: targets.filter((target) => target.role === role).map((target) => target.name),
		}))
		.filter((group) => group.names.length > 0);
};

export type Metric = {
	readonly key: MetricKey;
	readonly unit: MetricUnit;
	readonly value: (month: Month) => null | number;
};
export type MetricKey =
	| "pace"
	| "reps"
	| "oneRm"
	| "volume"
	| "maxReps"
	| "distance"
	| "duration"
	| "sessions"
	| "maxWeight"
	| "maxDuration";

type MetricUnit = "kmh" | "reps" | "weight" | "kg-reps" | "distance" | "duration" | "sessions";

const secondsPerHour = 3600;

const metricDefinitions: Readonly<Record<MetricKey, Metric>> = {
	reps: { key: "reps", unit: "reps", value: (month) => month.reps },
	oneRm: { key: "oneRm", unit: "weight", value: (month) => month.maxOneRm },
	volume: { key: "volume", unit: "kg-reps", value: (month) => month.volume },
	maxReps: { unit: "reps", key: "maxReps", value: (month) => month.maxReps },
	distance: { key: "distance", unit: "distance", value: (month) => month.distance },
	duration: { key: "duration", unit: "duration", value: (month) => month.duration },
	sessions: { key: "sessions", unit: "sessions", value: (month) => month.sessions },
	maxWeight: { unit: "weight", key: "maxWeight", value: (month) => month.maxWeight },
	maxDuration: { unit: "duration", key: "maxDuration", value: (month) => month.maxDuration },
	pace: {
		key: "pace",
		unit: "kmh",
		value: (month) => (month.maxPace === null ? null : month.maxPace * secondsPerHour),
	},
};

const metricKeysByKind: Readonly<Record<ExerciseKind, readonly MetricKey[]>> = {
	reps: ["reps", "maxReps", "sessions"],
	duration: ["duration", "maxDuration", "sessions"],
	reps_and_weight: ["oneRm", "maxWeight", "volume"],
	reps_and_duration: ["reps", "duration", "sessions"],
	distance_and_duration: ["distance", "duration", "pace"],
	reps_and_duration_and_distance: ["distance", "duration", "reps"],
};

export const metricsForKind = (kind: null | ExerciseKind): readonly Metric[] =>
	(kind === null ? (["sessions"] as const) : metricKeysByKind[kind]).map(
		(key) => metricDefinitions[key],
	);

export type SeriesRange = "1y" | "3y" | "all";

export const seriesRanges: readonly SeriesRange[] = ["1y", "3y", "all"];

const rangeMonths = { "1y": 12, "3y": 36 } as const;

export type MonthPoint = {
	readonly label: string;
	readonly index: number;
	readonly value: null | number;
};

const monthIndexOf = (date: Date, timeZone: TimeZone) => {
	const local = localDateOf(date, timeZone);
	return Number(local.slice(0, 4)) * 12 + Number(local.slice(5, 7)) - 1;
};

const monthLabel = (formatters: Formatters, index: number) =>
	formatters
		.dateTime({ month: "short", year: "numeric", timeZone: "UTC" })
		.format(new Date(Date.UTC(Math.floor(index / 12), index % 12, 1)));

export const buildMonthSeries = (
	formatters: Formatters,
	input: {
		readonly now: Date;
		readonly metric: Metric;
		readonly timeZone: TimeZone;
		readonly range: SeriesRange;
		readonly months: readonly Month[];
	},
): readonly MonthPoint[] => {
	const { now, range, months, metric, timeZone } = input;
	const values = new Map<number, null | number>();
	for (const month of months) {
		const date = parseDate(month.month);
		if (date !== null) {
			values.set(monthIndexOf(date, timeZone), metric.value(month));
		}
	}
	if (values.size === 0) {
		return [];
	}
	const current = monthIndexOf(now, timeZone);
	const end = range === "all" ? Math.max(current, ...values.keys()) : current;
	const start = range === "all" ? Math.min(...values.keys()) : end - rangeMonths[range] + 1;
	return Array.from({ length: end - start + 1 }, (_, offset) => {
		const index = start + offset;
		return { index, value: values.get(index) ?? null, label: monthLabel(formatters, index) };
	});
};

export const peakPoint = (points: readonly MonthPoint[]) =>
	points.reduce<null | MonthPoint>(
		(peak, point) =>
			point.value !== null && point.value > 0 && (peak === null || point.value > (peak.value ?? 0))
				? point
				: peak,
		null,
	);

type StatTile = { readonly label: string; readonly value: string; readonly detail: null | string };

const oneDecimalValue = (value: number) => Math.round(value * 10) / 10;

type TileKey =
	| "time"
	| "reps"
	| "sets"
	| "speed"
	| "volume"
	| "distance"
	| "bestReps"
	| "sessions"
	| "typicalSet"
	| "longestSet";

const maxMonth = (months: readonly Month[], pick: (month: Month) => null | number) =>
	months.reduce((best, month) => Math.max(best, pick(month) ?? 0), 0);

export const buildStatTiles = (
	formatters: Formatters,
	text: FitnessText,
	kind: null | ExerciseKind,
	totals: Totals,
	months: readonly Month[],
): readonly StatTile[] => {
	const sets = totals.sets;
	const reps = totals.reps ?? 0;
	const duration = totals.duration ?? 0;
	const distance = totals.distance ?? 0;
	const perSession = totals.sessions === 0 ? 0 : sets / totals.sessions;
	const label = (tile: TileKey) => text("client.exercise.tile", { tile });
	const tiles = {
		time: { detail: null, label: label("time"), value: formatDuration(formatters, duration) },
		distance: {
			detail: null,
			label: label("distance"),
			value: formatUnitValue(formatters, distance, "km"),
		},
		typicalSet: {
			detail: null,
			label: label("typicalSet"),
			value: sets === 0 ? "–" : formatClock(duration / sets),
		},
		longestSet: {
			detail: null,
			label: label("longestSet"),
			value: formatClock(maxMonth(months, (month) => month.maxDuration)),
		},
		bestReps: {
			detail: null,
			label: label("bestReps"),
			value: formatNumber(
				formatters,
				maxMonth(months, (month) => month.maxReps),
			),
		},
		volume: {
			detail: null,
			label: label("volume"),
			value:
				totals.volume === null ? "—" : formatWeightedVolume(formatters, text, totals.volume, false),
		},
		reps: {
			label: label("reps"),
			value: formatNumber(formatters, reps),
			detail:
				sets === 0
					? null
					: text("client.exercise.tile.reps-per-set", { value: oneDecimalValue(reps / sets) }),
		},
		speed: {
			detail: null,
			label: label("speed"),
			value:
				duration === 0
					? "–"
					: formatUnitValue(
							formatters,
							oneDecimalValue((distance / duration) * secondsPerHour),
							"km/h",
						),
		},
		sessions: {
			label: label("sessions"),
			value: formatNumber(formatters, totals.sessions),
			detail:
				perSession === 0
					? null
					: text("client.exercise.tile.sets-per-session", { value: oneDecimalValue(perSession) }),
		},
		sets: {
			label: label("sets"),
			value: formatNumber(formatters, sets),
			detail:
				[
					totals.warmUpSets === null || totals.warmUpSets === 0
						? null
						: text("client.exercise.tile.warm-up", { count: totals.warmUpSets }),
					totals.failureSets === null || totals.failureSets === 0
						? null
						: text("client.exercise.tile.failure", { count: totals.failureSets }),
				]
					.filter((part) => part !== null)
					.join(" · ") || null,
		},
	};
	const keys = {
		reps: ["sessions", "sets", "reps", "bestReps"],
		reps_and_duration: ["sessions", "sets", "reps", "time"],
		reps_and_weight: ["sessions", "sets", "reps", "volume"],
		duration: ["sessions", "time", "typicalSet", "longestSet"],
		distance_and_duration: ["sessions", "distance", "time", "speed"],
		reps_and_duration_and_distance: ["sessions", "distance", "time", "reps"],
	} as const;
	return (kind === null ? (["sessions", "sets"] as const) : keys[kind]).map((key) => tiles[key]);
};

export const personalBestTitle = (text: FitnessText, type: PersonalBest) =>
	text("client.exercise.personal-best", { type });

const personalBestOrder: readonly PersonalBest[] = [
	"one_rm",
	"weight",
	"volume",
	"reps",
	"time",
	"pace",
	"distance",
];

type PersonalBestEntry = { readonly type: PersonalBest; readonly row: PersonalBestRow };

export const latestPersonalBests = (
	rows: readonly PersonalBestRow[],
): readonly PersonalBestEntry[] => {
	const latest = new Map<PersonalBest, PersonalBestRow>();
	for (const row of rows) {
		for (const type of row.personalBests) {
			const current = latest.get(type);
			if (current === undefined || row.occurredAt > current.occurredAt) {
				latest.set(type, row);
			}
		}
	}
	return personalBestOrder.flatMap((type) => {
		const row = latest.get(type);
		return row === undefined ? [] : [{ row, type }];
	});
};

export const bestWeightByReps = (totals: Totals) => {
	const weights = [
		totals.weightForReps1,
		totals.weightForReps5,
		totals.weightForReps8,
		totals.weightForReps12,
		totals.weightForReps30,
	];
	return bestWeightRepThresholds.flatMap((reps, index) => {
		const weight = weights[index];
		return weight === null || weight === undefined ? [] : [{ reps, weight }];
	});
};

/** Calendar days from `value` to `now` in `timeZone`, never negative. */
export const daysSince = (value: null | string, now: Date, timeZone: TimeZone) => {
	const date = parseDate(value);
	return date === null
		? null
		: Math.max(0, calendarDaysBetween(localDateOf(date, timeZone), localDateOf(now, timeZone)));
};

export const isLapsed = (lastAt: null | string, now: Date, timeZone: TimeZone) => {
	const days = daysSince(lastAt, now, timeZone);
	return days !== null && days > 365;
};

export type NoteSource =
	{ readonly kind: "set" } | { readonly name: string; readonly kind: "workout" };

export type WorkoutNote = {
	readonly text: string;
	readonly count: number;
	readonly source: NoteSource;
	readonly latestAt: null | string;
};

const timeOrNegative = (value: null | string) =>
	parseDate(value)?.getTime() ?? Number.NEGATIVE_INFINITY;

const workoutNoteOccurrences = (
	setNotes: readonly SetNote[],
	workoutNotes: readonly WorkoutNoteRow[],
) => [
	...setNotes.map((row) => ({
		text: row.note,
		at: row.workoutStartedAt,
		source: { kind: "set" } as const,
	})),
	...workoutNotes.flatMap((row) =>
		(row.exerciseNotes ?? [])
			.filter((entry) => entry.exerciseOrder === row.exerciseOrder)
			.flatMap((entry) =>
				entry.notes.map((text) => ({
					text,
					at: row.startedAt,
					source: { name: row.name, kind: "workout" } as const,
				})),
			),
	),
];

export const dedupeWorkoutNotes = (
	setNotes: readonly SetNote[],
	workoutNotes: readonly WorkoutNoteRow[],
): readonly WorkoutNote[] => {
	const notes = new Map<string, WorkoutNote>();
	for (const occurrence of workoutNoteOccurrences(setNotes, workoutNotes)) {
		const text = occurrence.text.trim();
		if (text === "") {
			continue;
		}
		const existing = notes.get(text);
		if (existing === undefined) {
			notes.set(text, { text, count: 1, latestAt: occurrence.at, source: occurrence.source });
		} else if (timeOrNegative(occurrence.at) > timeOrNegative(existing.latestAt)) {
			notes.set(text, {
				text,
				latestAt: occurrence.at,
				source: occurrence.source,
				count: existing.count + 1,
			});
		} else {
			notes.set(text, { ...existing, count: existing.count + 1 });
		}
	}
	return [...notes.values()].sort(
		(left, right) =>
			timeOrNegative(right.latestAt) - timeOrNegative(left.latestAt) ||
			left.text.localeCompare(right.text),
	);
};
