import {
	bestWeightRepThresholds,
	type ExerciseDetails,
} from "../../shared/exercise-details-recipes";
import type { ExerciseKind } from "../../shared/exercise-kinds";
import type { PersonalBest } from "../../shared/workout-records";
import { formatClock, formatDuration, formatNumber, parseDate } from "../workout/format";

export type ExerciseRecord = NonNullable<ExerciseDetails["exercise"]>;
type Month = ExerciseDetails["months"][number];
type Totals = ExerciseDetails["totals"];
export type PersonalBestRow = ExerciseDetails["personalBests"][number];
type Target = ExerciseRecord["targets"]["items"][number];
type SetNote = ExerciseDetails["setNotes"][number];
type WorkoutNoteRow = ExerciseDetails["workoutNotes"][number];

export const isCustomExercise = (exercise: ExerciseRecord) => exercise.userId !== null;

export const kindLabels: Readonly<Record<ExerciseKind, string>> = {
	reps: "Reps",
	duration: "Duration",
	reps_and_weight: "Weight × reps",
	reps_and_duration: "Reps & duration",
	distance_and_duration: "Distance & time",
	reps_and_duration_and_distance: "Reps, time & distance",
};

export const mechanicLabels = { compound: "Compound", isolation: "Isolation" } as const;
export const forceLabels = { pull: "Pull", push: "Push", static: "Static" } as const;
export const levelLabels = {
	expert: "Expert",
	beginner: "Beginner",
	intermediate: "Intermediate",
} as const;

type FactRow = { readonly label: string; readonly value: string };

export const exerciseFacts = (exercise: ExerciseRecord): readonly FactRow[] => {
	const equipment = exercise.equipment.items.map((item) => item.name).join(", ");
	const rows: ReadonlyArray<FactRow | null> = [
		equipment === "" ? null : { value: equipment, label: "Equipment" },
		exercise.kind === null ? null : { label: "Tracked as", value: kindLabels[exercise.kind] },
		exercise.mechanic === null
			? null
			: { label: "Mechanic", value: mechanicLabels[exercise.mechanic] },
		exercise.force === null ? null : { label: "Force", value: forceLabels[exercise.force] },
		exercise.level === null ? null : { label: "Level", value: levelLabels[exercise.level] },
	];
	return rows.filter((row) => row !== null);
};

type MuscleGroup = { readonly label: string | null; readonly names: readonly string[] };

const roleGroups = [
	{ role: "primary", label: "Primary" },
	{ role: "secondary", label: "Secondary" },
	{ role: "stabilizer", label: "Stabilizer" },
	{ role: null, label: "Other" },
] as const;

export const groupTargets = (targets: readonly Target[]): readonly MuscleGroup[] => {
	if (targets.length === 0) {
		return [];
	}
	if (targets.every((target) => target.role === null)) {
		return [{ label: null, names: targets.map((target) => target.name) }];
	}
	return roleGroups
		.map(({ role, label }) => ({
			label,
			names: targets.filter((target) => target.role === role).map((target) => target.name),
		}))
		.filter((group) => group.names.length > 0);
};

type MetricUnit = "kg" | "km" | "kmh" | "reps" | "seconds" | "sessions";
type MetricKey =
	| "distance"
	| "duration"
	| "maxDuration"
	| "maxReps"
	| "maxWeight"
	| "oneRm"
	| "pace"
	| "reps"
	| "sessions"
	| "volume";

export type Metric = {
	readonly key: MetricKey;
	readonly label: string;
	readonly title: string;
	readonly unit: MetricUnit;
	readonly value: (month: Month) => number | null;
};

const secondsPerHour = 3600;

const metricDefinitions: Readonly<Record<MetricKey, Metric>> = {
	reps: {
		key: "reps",
		unit: "reps",
		label: "Total reps",
		title: "Reps per month",
		value: (month) => month.reps,
	},
	volume: {
		unit: "kg",
		key: "volume",
		label: "Volume",
		title: "Volume per month",
		value: (month) => month.volume,
	},
	oneRm: {
		unit: "kg",
		key: "oneRm",
		label: "1RM",
		value: (month) => month.maxOneRm,
		title: "Est. one-rep max per month",
	},
	maxReps: {
		unit: "reps",
		key: "maxReps",
		label: "Best set",
		title: "Best set per month",
		value: (month) => month.maxReps,
	},
	distance: {
		unit: "km",
		key: "distance",
		label: "Distance",
		title: "Distance per month",
		value: (month) => month.distance,
	},
	duration: {
		unit: "seconds",
		key: "duration",
		label: "Total time",
		title: "Time per month",
		value: (month) => month.duration,
	},
	sessions: {
		key: "sessions",
		unit: "sessions",
		label: "Sessions",
		title: "Sessions per month",
		value: (month) => month.sessions,
	},
	maxWeight: {
		unit: "kg",
		label: "Weight",
		key: "maxWeight",
		value: (month) => month.maxWeight,
		title: "Heaviest weight per month",
	},
	maxDuration: {
		unit: "seconds",
		key: "maxDuration",
		label: "Longest set",
		title: "Longest set per month",
		value: (month) => month.maxDuration,
	},
	pace: {
		key: "pace",
		unit: "kmh",
		label: "Speed",
		title: "Best speed per month",
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

export const metricsForKind = (kind: ExerciseKind | null): readonly Metric[] =>
	(kind === null ? (["sessions"] as const) : metricKeysByKind[kind]).map(
		(key) => metricDefinitions[key],
	);

export type SeriesRange = "1y" | "3y" | "all";

export const seriesRanges: ReadonlyArray<{ readonly value: SeriesRange; readonly label: string }> =
	[
		{ value: "1y", label: "1Y" },
		{ value: "3y", label: "3Y" },
		{ value: "all", label: "All" },
	];

const rangeMonths = { "1y": 12, "3y": 36 } as const;

export type MonthPoint = {
	readonly label: string;
	readonly index: number;
	readonly value: number | null;
};

const monthIndexOf = (date: Date, timeZone: string) => {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "numeric",
	}).formatToParts(date);
	const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
	return part("year") * 12 + part("month") - 1;
};

const monthLabel = (index: number) =>
	new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
		new Date(Date.UTC(Math.floor(index / 12), index % 12, 1)),
	);

export const buildMonthSeries = (input: {
	readonly now: Date;
	readonly metric: Metric;
	readonly timeZone: string;
	readonly range: SeriesRange;
	readonly months: readonly Month[];
}): readonly MonthPoint[] => {
	const { now, range, months, metric, timeZone } = input;
	const values = new Map<number, number | null>();
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
		return { index, label: monthLabel(index), value: values.get(index) ?? null };
	});
};

export const peakPoint = (points: readonly MonthPoint[]) =>
	points.reduce<MonthPoint | null>(
		(peak, point) =>
			point.value !== null && point.value > 0 && (peak === null || point.value > (peak.value ?? 0))
				? point
				: peak,
		null,
	);

type StatTile = { readonly label: string; readonly value: string; readonly detail: string | null };

const oneDecimal = (value: number) => formatNumber(Math.round(value * 10) / 10);

const maxMonth = (months: readonly Month[], pick: (month: Month) => number | null) =>
	months.reduce((best, month) => Math.max(best, pick(month) ?? 0), 0);

export const buildStatTiles = (
	kind: ExerciseKind | null,
	totals: Totals,
	months: readonly Month[],
): readonly StatTile[] => {
	const sets = totals.sets;
	const reps = totals.reps ?? 0;
	const volume = totals.volume ?? 0;
	const duration = totals.duration ?? 0;
	const distance = totals.distance ?? 0;
	const perSession = totals.sessions === 0 ? 0 : sets / totals.sessions;
	const tiles = {
		time: { detail: null, label: "Total time", value: formatDuration(duration) },
		distance: { detail: null, label: "Distance", value: `${formatNumber(distance)} km` },
		typicalSet: {
			detail: null,
			label: "Typical set",
			value: sets === 0 ? "–" : formatClock(duration / sets),
		},
		longestSet: {
			detail: null,
			label: "Longest set",
			value: formatClock(maxMonth(months, (month) => month.maxDuration)),
		},
		bestReps: {
			detail: null,
			label: "Most reps in a set",
			value: formatNumber(maxMonth(months, (month) => month.maxReps)),
		},
		reps: {
			label: "Total reps",
			value: formatNumber(reps),
			detail: sets === 0 ? null : `${oneDecimal(reps / sets)} per set on average`,
		},
		speed: {
			detail: null,
			label: "Average speed",
			value: duration === 0 ? "–" : `${oneDecimal((distance / duration) * secondsPerHour)} km/h`,
		},
		sessions: {
			label: "Sessions",
			value: formatNumber(totals.sessions),
			detail: perSession === 0 ? null : `${oneDecimal(perSession)} sets per session`,
		},
		volume: {
			label: "Total volume",
			detail: `${formatNumber(volume)} kg lifted`,
			value: volume >= 1000 ? `${oneDecimal(volume / 1000)} t` : `${formatNumber(volume)} kg`,
		},
		sets: {
			label: "Sets",
			value: formatNumber(sets),
			detail:
				[
					totals.warmUpSets === null || totals.warmUpSets === 0
						? null
						: `${formatNumber(totals.warmUpSets)} warm-up`,
					totals.failureSets === null || totals.failureSets === 0
						? null
						: `${formatNumber(totals.failureSets)} to failure`,
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

export const personalBestTitles: Readonly<Record<PersonalBest, string>> = {
	reps: "Most reps",
	time: "Longest set",
	pace: "Fastest speed",
	volume: "Best set volume",
	weight: "Heaviest weight",
	one_rm: "Est. one-rep max",
	distance: "Longest distance",
};

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

const dayMs = 86_400_000;

export const daysSince = (value: string | null, now: Date) => {
	const date = parseDate(value);
	return date === null ? null : Math.floor((now.getTime() - date.getTime()) / dayMs);
};

export const isLapsed = (lastAt: string | null, now: Date) => {
	const days = daysSince(lastAt, now);
	return days !== null && days > 365;
};

export const describeAgo = (days: number) => {
	if (days <= 0) {
		return "today";
	}
	if (days === 1) {
		return "yesterday";
	}
	if (days < 30) {
		return `${days} days ago`;
	}
	if (days < 365) {
		const months = Math.floor(days / 30);
		return `${months} ${months === 1 ? "month" : "months"} ago`;
	}
	const years = Math.floor(days / 365);
	return `${years} ${years === 1 ? "year" : "years"} ago`;
};

export type WorkoutNote = {
	readonly text: string;
	readonly count: number;
	readonly source: string;
	readonly latestAt: string | null;
};

const timeOrNegative = (value: string | null) =>
	parseDate(value)?.getTime() ?? Number.NEGATIVE_INFINITY;

const workoutNoteOccurrences = (
	setNotes: readonly SetNote[],
	workoutNotes: readonly WorkoutNoteRow[],
) => [
	...setNotes.map((row) => ({ text: row.note, source: "Set note", at: row.workoutStartedAt })),
	...workoutNotes.flatMap((row) =>
		(row.exerciseNotes ?? [])
			.filter((entry) => entry.exerciseOrder === row.exerciseOrder)
			.flatMap((entry) =>
				entry.notes.map((text) => ({ text, source: row.name, at: row.startedAt })),
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

export const ratingSteps = 5;
const ratingStep = 20;

export const ratingToStars = (rating: number | null) => {
	if (rating === null) {
		return null;
	}
	const stars = Math.min(Math.round(rating / ratingStep), ratingSteps);
	return stars < 1 ? null : stars;
};

export const starsToRating = (stars: number) => stars * ratingStep;
