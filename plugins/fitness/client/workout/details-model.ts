import type { ExerciseKind } from "../../shared/exercise-kinds";
import {
	elapsedWorkoutSeconds,
	type MuscleSource,
	summarizeRecordedSets,
} from "../../shared/fitness-metrics";
import type { WorkoutDetails } from "../../shared/workout-details-recipes";
import type { PersonalBest } from "../../shared/workout-records";
import type { WorkoutTaxonomy } from "../../shared/workout-taxonomy-recipes";
import { supersetLetter } from "../group-colors";
import { type Measure, parseDate } from "./format";

export type WorkoutSet = WorkoutExercise["sets"]["items"][number];
export type WorkoutTimeline = {
	readonly restSeconds: number;
	readonly segments: readonly TimelineSegment[];
};
export type WorkoutExercise = WorkoutDetails["exercises"]["items"][number] &
	Pick<WorkoutTaxonomy, "targets" | "equipment">;
export type TimelineSegment = {
	readonly key: string;
	readonly label: string;
	readonly seconds: number;
	readonly superset: boolean;
};

export type CardGroup =
	| { readonly kind: "single"; readonly card: ExerciseCard }
	| {
			readonly label: string;
			readonly color: string;
			readonly kind: "superset";
			readonly cards: readonly ExerciseCard[];
	  };

export type WorkoutSummary = {
	readonly reps: number;
	readonly sets: number;
	readonly exercises: number;
	readonly restSeconds: number;
	readonly volume: null | number;
	readonly records: null | number;
	readonly recordSets: null | number;
	readonly volumeDelta: null | number;
	readonly durationSeconds: null | number;
};

export type ExerciseCard = {
	readonly key: string;
	readonly order: number;
	readonly notes: readonly string[];
	readonly kind: null | ExerciseKind;
	readonly exercise: WorkoutExercise;
	readonly supersetTag: null | string;
	readonly sets: readonly WorkoutSet[];
	readonly recordStatus: WorkoutSet["recordStatus"];
	readonly total: null | { readonly value: number; readonly measure: CardMeasure };
	readonly media: undefined | NonNullable<WorkoutDetails["exerciseMedia"]>[number];
	readonly comparison: null | {
		readonly delta: number;
		readonly measure: CardMeasure;
		readonly previousStartedAt: string;
	};
};

type CardMeasure = Exclude<Measure, "weight">;

type PreviousSet = WorkoutExercise["previousSets"]["items"][number];

type Measured = Pick<PreviousSet, "reps" | "volume" | "distance" | "duration">;

const measureByKind: Record<ExerciseKind, CardMeasure> = {
	reps: "reps",
	duration: "duration",
	reps_and_duration: "reps",
	reps_and_weight: "volume",
	distance_and_duration: "distance",
	reps_and_duration_and_distance: "distance",
};

const measureOf = (set: Measured, measure: CardMeasure) => {
	if (measure === "volume") {
		return "recordStatus" in set && set.recordStatus === "ready" ? set.volume : null;
	}
	return set[measure];
};

const sumMeasure = (sets: readonly Measured[], measure: CardMeasure) =>
	sets.reduce<null | number>((total, set) => {
		const value = measureOf(set, measure);
		return total === null || value === null ? null : total + value;
	}, 0);

const timeOf = (value: null | string) => parseDate(value)?.getTime() ?? null;

const cardRecordStatus = (sets: readonly WorkoutSet[]): WorkoutSet["recordStatus"] => {
	if (sets.some((set) => set.recordStatus === "failed")) {
		return "failed";
	}
	return sets.some((set) => set.recordStatus !== "ready") ? "pending" : "ready";
};

export const buildExerciseGroups = (workout: WorkoutDetails): readonly CardGroup[] => {
	const occurrences = workout.exercises.items.flatMap((exercise) => {
		const byOrder = new Map<number, WorkoutSet[]>();
		for (const set of exercise.sets.items) {
			const order = set.exerciseOrder ?? 0;
			byOrder.set(order, [...(byOrder.get(order) ?? []), set]);
		}
		return [...byOrder.entries()].map(([order, sets]) => ({ sets, order, exercise }));
	});
	const occurrenceCount = new Map<string, number>();
	for (const { exercise } of occurrences) {
		occurrenceCount.set(exercise.id, (occurrenceCount.get(exercise.id) ?? 0) + 1);
	}
	const supersets = (workout.supersets ?? []).map((superset, index) => ({
		color: superset.color,
		label: supersetLetter(index),
		orders: [...superset.exercises].sort((left, right) => left - right),
	}));
	const cards = occurrences
		.sort((left, right) => left.order - right.order)
		.map(({ sets, order, exercise }): ExerciseCard => {
			const taxonomy = workout.taxonomy.find(
				(item) => item.exerciseId === exercise.id && item.exerciseOrder === order,
			);
			const kind = sets[0]?.exerciseKind ?? null;
			const measure = kind === null ? null : measureByKind[kind];
			let value = measure === null ? null : sumMeasure(sets, measure);
			if (measure === "volume") {
				value = sets.some((set) => set.volume === null) ? null : summarizeRecordedSets(sets).volume;
			}
			const previous = measure === null ? null : sumMeasure(exercise.previousSets.items, measure);
			const superset = supersets.find(({ orders }) => orders.includes(order));
			const previousStartedAt = exercise.previousWorkoutStartedAt;
			const comparison =
				measure !== null &&
				value !== null &&
				previous !== null &&
				cardRecordStatus(sets) === "ready" &&
				previousStartedAt !== null &&
				exercise.previousSets.items.length > 0 &&
				occurrenceCount.get(exercise.id) === 1
					? { measure, previousStartedAt, delta: value - previous }
					: null;
			return {
				kind,
				sets,
				order,
				comparison,
				key: `${order}:${exercise.id}`,
				recordStatus: cardRecordStatus(sets),
				total: measure === null || value === null ? null : { value, measure },
				media: workout.exerciseMedia?.find(({ exerciseOrder }) => exerciseOrder === order),
				notes:
					workout.exerciseNotes?.find(({ exerciseOrder }) => exerciseOrder === order)?.notes ?? [],
				supersetTag:
					superset === undefined ? null : `${superset.label}${superset.orders.indexOf(order) + 1}`,
				exercise: {
					...exercise,
					targets: taxonomy?.targets ?? { items: [], pageInfo: { limit: 100, hasMore: false } },
					equipment: taxonomy?.equipment ?? { items: [], pageInfo: { limit: 100, hasMore: false } },
				},
			};
		});
	const groups: CardGroup[] = [];
	for (const card of cards) {
		const superset = supersets.find(({ orders }) => orders.includes(card.order));
		const last = groups.at(-1);
		if (superset === undefined) {
			groups.push({ card, kind: "single" });
		} else if (last?.kind === "superset" && last.label === superset.label) {
			groups[groups.length - 1] = { ...last, cards: [...last.cards, card] };
		} else {
			groups.push({
				cards: [card],
				kind: "superset",
				label: superset.label,
				color: superset.color,
			});
		}
	}
	return groups;
};

const groupCards = (group: CardGroup) => (group.kind === "single" ? [group.card] : group.cards);

export const summarizeWorkout = (
	workout: WorkoutDetails,
	groups: readonly CardGroup[],
): WorkoutSummary => {
	const sets = workout.exercises.items.flatMap((exercise) => exercise.sets.items);
	const metrics = summarizeRecordedSets(sets);
	const volume = sets.some((set) => set.exerciseKind === "reps_and_weight" && set.volume === null)
		? null
		: metrics.volume;
	const volumeDeltas = groups
		.flatMap(groupCards)
		.flatMap((card) => (card.comparison?.measure === "volume" ? [card.comparison.delta] : []));
	return {
		volume,
		sets: metrics.sets,
		reps: metrics.repetitions,
		records: metrics.personalBests,
		restSeconds: metrics.plannedRest,
		recordSets: metrics.personalBestSets,
		exercises: groups.flatMap(groupCards).length,
		durationSeconds: elapsedWorkoutSeconds(workout.startedAt, workout.endedAt),
		volumeDelta:
			volume === null || volumeDeltas.length === 0
				? null
				: volumeDeltas.reduce((total, delta) => total + delta, 0),
	};
};

export const buildTimeline = (
	workout: WorkoutDetails,
	groups: readonly CardGroup[],
	restSeconds: number,
): null | WorkoutTimeline => {
	const started = timeOf(workout.startedAt);
	const ended = timeOf(workout.endedAt);
	if (started === null || ended === null || ended <= started || groups.length === 0) {
		return null;
	}
	const segments: TimelineSegment[] = [];
	let cursor = started;
	for (const group of groups) {
		const cards = groupCards(group);
		const finishes = cards
			.flatMap((card) => card.sets)
			.map((set) => timeOf(set.confirmedAt))
			.filter((time) => time !== null);
		if (finishes.length === 0) {
			return null;
		}
		const finish = Math.max(...finishes);
		if (finish < cursor || finish > ended) {
			return null;
		}
		segments.push({
			seconds: (finish - cursor) / 1000,
			superset: group.kind === "superset",
			key: cards.map((card) => card.key).join("+"),
			label:
				group.kind === "superset"
					? `Superset ${group.label}`
					: (cards[0]?.exercise.name ?? "Exercise"),
		});
		cursor = finish;
	}
	return { segments, restSeconds };
};

export const cardMuscleSources = (groups: readonly CardGroup[]): readonly MuscleSource[] => {
	const cards = groups.flatMap(groupCards);
	return cards.every((card) => card.recordStatus === "ready")
		? cards.map((card) => ({ sets: card.sets.length, targets: card.exercise.targets.items }))
		: [];
};

export const personalBestLabels: Readonly<Record<PersonalBest, string>> = {
	time: "Time",
	pace: "Pace",
	reps: "Reps",
	one_rm: "1RM",
	volume: "Volume",
	weight: "Weight",
	distance: "Distance",
};
