import {
	type CreateUserWorkoutMutationVariables,
	type ExerciseLot,
	type SetLot,
	type UserWorkoutSetRecord,
	type WorkoutDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { atomWithReset, atomWithStorage } from "jotai/utils";
import type { DateTime } from "luxon";
import { LOCAL_STORAGE_KEYS } from "./constants";

export type ExerciseSetStats = {
	duration?: number | null;
	weight?: number | null;
	reps?: number | null;
	distance?: number | null;
	oneRm?: number | null;
};

export type ExerciseSet = {
	statistic: ExerciseSetStats;
	lot: SetLot;
	confirmed: boolean;
	confirmedAt?: string | null;
};

type AlreadyDoneExerciseSet = Pick<ExerciseSet, "statistic">;

export type Exercise = {
	name: string;
	exerciseId: string;
	lot: ExerciseLot;
	notes: Array<string>;
	sets: Array<ExerciseSet>;
	alreadyDoneSets: Array<AlreadyDoneExerciseSet>;
	restTimer?: { enabled: boolean; duration: number } | null;
	videos: string[];
	images: string[];
};

type InProgressWorkout = {
	startTime: string;
	endTime?: string;
	name: string;
	comment?: string;
	exercises: Array<Exercise>;
	videos: Array<string>;
	images: Array<string>;
	// TODO: Superset support pending
	// supersets: Array<Array<number>>;
};

export const currentWorkoutAtom = atomWithStorage<InProgressWorkout | null>(
	LOCAL_STORAGE_KEYS.currentWorkout,
	null,
);

function getTimeOfDay(date: Date) {
	const hours = date.getHours();
	if (hours >= 5 && hours < 12) return "Morning";
	else if (hours >= 12 && hours < 17) return "Afternoon";
	else if (hours >= 17 && hours < 21) return "Evening";
	else return "Night";
}

export const getDefaultWorkout = (): InProgressWorkout => {
	const date = new Date();
	return {
		name: `${getTimeOfDay(date)} Workout`,
		startTime: date.toISOString(),
		exercises: [],
		images: [],
		videos: [],
		// supersets: [],
	};
};

export const duplicateOldWorkout = (
	workout: WorkoutDetailsQuery["workoutDetails"],
) => {
	const inProgress = getDefaultWorkout();
	inProgress.name = workout.name;
	for (const ex of workout.information.exercises) {
		const sets = ex.sets.map((s) => ({
			confirmed: false,
			lot: s.lot,
			statistic: {
				...s.statistic,
				duration: s.statistic.duration
					? Number(s.statistic.duration)
					: undefined,
				distance: s.statistic.distance
					? Number(s.statistic.distance)
					: undefined,
				weight: s.statistic.weight ? Number(s.statistic.weight) : undefined,
			},
			endedAt: s.confirmedAt,
		}));
		inProgress.exercises.push({
			images: [],
			videos: [],
			// biome-ignore lint/suspicious/noExplicitAny: required here
			alreadyDoneSets: sets.map((s) => ({ statistic: s.statistic }) as any),
			exerciseId: ex.id,
			lot: ex.lot,
			name: ex.id,
			notes: ex.notes,
			restTimer: ex.restTime ? { duration: ex.restTime, enabled: true } : null,
			// biome-ignore lint/suspicious/noExplicitAny: required here
			sets: sets as any,
		});
	}
	return inProgress;
};

export const currentWorkoutToCreateWorkoutInput = (
	currentWorkout: InProgressWorkout,
) => {
	const input: CreateUserWorkoutMutationVariables = {
		input: {
			endTime: new Date(),
			startTime: new Date(currentWorkout.startTime),
			name: currentWorkout.name,
			comment: currentWorkout.comment,
			supersets: [],
			exercises: [],
			assets: {
				images: [...currentWorkout.images],
				videos: [...currentWorkout.videos],
			},
		},
	};
	for (const exercise of currentWorkout.exercises) {
		const sets = Array<UserWorkoutSetRecord>();
		for (const set of exercise.sets)
			if (set.confirmed) {
				sets.push({
					lot: set.lot,
					confirmedAt: set.confirmedAt ? new Date(set.confirmedAt) : undefined,
					statistic: {
						...set.statistic,
						distance: set.statistic.distance?.toString(),
						duration: set.statistic.duration?.toString(),
						weight: set.statistic.weight?.toString(),
						// biome-ignore lint/suspicious/noExplicitAny: required here
					} as any,
				});
			}
		if (sets.length === 0) continue;
		const notes = Array<string>();
		for (const note of exercise.notes) if (note) notes.push(note);
		input.input.exercises.push({
			exerciseId: exercise.exerciseId,
			notes,
			sets,
			assets: { images: [...exercise.images], videos: [...exercise.videos] },
			restTime: exercise.restTimer
				? exercise.restTimer.enabled
					? exercise.restTimer.duration
					: undefined
				: undefined,
		});
	}
	return input;
};

type Timer = {
	totalTime: number;
	endAt: DateTime;
	triggeredByIdx?: { exercise: number; set: number };
};

export const timerAtom = atomWithReset<Timer | null>(null);
