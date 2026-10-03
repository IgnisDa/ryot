import type { ExerciseKind } from "../../shared/exercise-kinds";
import type { WorkoutDetails } from "../../shared/workout-details-recipes";
import type { PersonalBest } from "../../shared/workout-records";

export type WorkoutExercise = WorkoutDetails["exercises"]["items"][number];
export type WorkoutSet = WorkoutExercise["sets"]["items"][number];
type PreviousSet = WorkoutExercise["previousSets"]["items"][number];
type Measured = Pick<PreviousSet, "distance" | "duration" | "reps" | "volume">;

export type MeasureUnit = "kg" | "km" | "reps" | "seconds";

export type ExerciseCard = {
	readonly key: string;
	readonly order: number;
	readonly kind: ExerciseKind | null;
	readonly notes: readonly string[];
	readonly exercise: WorkoutExercise;
	readonly sets: readonly WorkoutSet[];
	readonly supersetTag: string | null;
	readonly recordStatus: WorkoutSet["recordStatus"];
	readonly comparison: {
		readonly delta: number;
		readonly unit: MeasureUnit;
		readonly previousStartedAt: string;
	} | null;
	readonly total: { readonly value: number; readonly unit: MeasureUnit } | null;
};

export type CardGroup =
	| { readonly kind: "single"; readonly card: ExerciseCard }
	| { readonly kind: "superset"; readonly label: string; readonly cards: readonly ExerciseCard[] };

export type TimelineSegment = {
	readonly key: string;
	readonly label: string;
	readonly seconds: number;
	readonly superset: boolean;
};

export type WorkoutTimeline = {
	readonly segments: readonly TimelineSegment[];
	readonly restSeconds: number;
	readonly workingSeconds: number;
};

export type WorkoutSummary = {
	readonly reps: number;
	readonly sets: number;
	readonly volume: number;
	readonly records: number;
	readonly recordSets: number;
	readonly exercises: number;
	readonly restSeconds: number;
	readonly durationSeconds: number | null;
	readonly volumeDelta: number | null;
};

const measureUnitByKind: Record<ExerciseKind, MeasureUnit> = {
	reps: "reps",
	duration: "seconds",
	reps_and_weight: "kg",
	reps_and_duration: "reps",
	distance_and_duration: "km",
	reps_and_duration_and_distance: "km",
};

const measureOf = (set: Measured, unit: MeasureUnit) => {
	if (unit === "kg") {
		return set.volume ?? 0;
	}
	if (unit === "km") {
		return set.distance ?? 0;
	}
	if (unit === "reps") {
		return set.reps ?? 0;
	}
	return set.duration ?? 0;
};

const sumMeasure = (sets: readonly Measured[], unit: MeasureUnit) =>
	sets.reduce((total, set) => total + measureOf(set, unit), 0);

const timeOf = (value: string | null) => {
	if (value === null) {
		return null;
	}
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : null;
};

const cardRecordStatus = (sets: readonly WorkoutSet[]): WorkoutSet["recordStatus"] => {
	if (sets.some((set) => set.recordStatus === "failed")) {
		return "failed";
	}
	return sets.some((set) => set.recordStatus === "pending") ? "pending" : "ready";
};

const supersetLetter = (index: number) => String.fromCharCode(65 + (index % 26));

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
		label: supersetLetter(index),
		orders: [...superset.exercises].sort((left, right) => left - right),
	}));
	const cards = occurrences
		.sort((left, right) => left.order - right.order)
		.map(({ sets, order, exercise }): ExerciseCard => {
			const kind = sets[0]?.exerciseKind ?? null;
			const unit = kind === null ? null : measureUnitByKind[kind];
			const superset = supersets.find(({ orders }) => orders.includes(order));
			const previousStartedAt = exercise.previousWorkoutStartedAt;
			const comparison =
				unit !== null &&
				previousStartedAt !== null &&
				exercise.previousSets.items.length > 0 &&
				occurrenceCount.get(exercise.id) === 1
					? {
							unit,
							previousStartedAt,
							delta: sumMeasure(sets, unit) - sumMeasure(exercise.previousSets.items, unit),
						}
					: null;
			return {
				kind,
				sets,
				order,
				exercise,
				comparison,
				key: `${order}:${exercise.id}`,
				recordStatus: cardRecordStatus(sets),
				total: unit === null ? null : { unit, value: sumMeasure(sets, unit) },
				notes:
					workout.exerciseNotes?.find(({ exerciseOrder }) => exerciseOrder === order)?.notes ?? [],
				supersetTag:
					superset === undefined ? null : `${superset.label}${superset.orders.indexOf(order) + 1}`,
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
			groups.push({ cards: [card], kind: "superset", label: superset.label });
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
	const started = timeOf(workout.startedAt);
	const ended = timeOf(workout.endedAt);
	const volumeDeltas = groups
		.flatMap(groupCards)
		.flatMap((card) => (card.comparison?.unit === "kg" ? [card.comparison.delta] : []));
	return {
		sets: sets.length,
		exercises: groups.flatMap(groupCards).length,
		reps: sets.reduce((total, set) => total + (set.reps ?? 0), 0),
		volume: sets.reduce((total, set) => total + (set.volume ?? 0), 0),
		restSeconds: sets.reduce((total, set) => total + (set.restTime ?? 0), 0),
		recordSets: sets.filter((set) => (set.personalBests?.length ?? 0) > 0).length,
		records: sets.reduce((total, set) => total + (set.personalBests?.length ?? 0), 0),
		volumeDelta:
			volumeDeltas.length === 0 ? null : volumeDeltas.reduce((total, delta) => total + delta, 0),
		durationSeconds:
			started !== null && ended !== null && ended >= started ? (ended - started) / 1000 : null,
	};
};

export const buildTimeline = (
	workout: WorkoutDetails,
	groups: readonly CardGroup[],
	restSeconds: number,
): WorkoutTimeline | null => {
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
	const totalSeconds = (ended - started) / 1000;
	return { segments, restSeconds, workingSeconds: Math.max(totalSeconds - restSeconds, 0) };
};

export type MuscleCount = { readonly name: string; readonly sets: number };

export const countMuscleSets = (groups: readonly CardGroup[]): readonly MuscleCount[] => {
	const counts = new Map<string, number>();
	for (const card of groups.flatMap(groupCards)) {
		for (const target of card.exercise.targets.items) {
			if (target.role !== "stabilizer") {
				counts.set(target.name, (counts.get(target.name) ?? 0) + card.sets.length);
			}
		}
	}
	return [...counts.entries()]
		.map(([name, sets]) => ({ name, sets }))
		.sort((left, right) => right.sets - left.sets || left.name.localeCompare(right.name))
		.slice(0, 6);
};

export const countEquipment = (groups: readonly CardGroup[]) => {
	const counts = new Map<string, number>();
	for (const card of groups.flatMap(groupCards)) {
		for (const { name } of card.exercise.equipment.items) {
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([name, exercises]) => ({ name, exercises }))
		.sort((left, right) => right.exercises - left.exercises || left.name.localeCompare(right.name));
};

const setLotLetters: Readonly<Record<string, string>> = { drop: "D", failure: "F", warm_up: "W" };

export const setLabels = (sets: readonly WorkoutSet[]) => {
	let working = 0;
	return sets.map((set) => {
		const letter = set.setLot === null ? undefined : setLotLetters[set.setLot];
		if (letter !== undefined) {
			return letter;
		}
		working += 1;
		return String(working);
	});
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
