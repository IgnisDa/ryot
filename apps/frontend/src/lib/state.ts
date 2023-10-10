import {
	type CreateUserWorkoutMutationVariables,
	type ExerciseLot,
	type SetLot,
	type UserWorkoutSetRecord,
} from "@ryot/generated/graphql/backend/graphql";
import type { Immutable } from "immer";
import { atomWithReset, atomWithStorage } from "jotai/utils";

export type ExerciseSetStats = Immutable<{
	duration?: number | null;
	weight?: number | null;
	reps?: number | null;
	distance?: number | null;
}>;

export type ExerciseSet = Immutable<{
	statistic: ExerciseSetStats;
	lot: SetLot;
	confirmed: boolean;
}>;

type AlreadyDoneExerciseSet = Pick<ExerciseSet, "statistic">;

export type Exercise = Immutable<{
	name: string;
	exerciseId: number;
	lot: ExerciseLot;
	notes: Array<string>;
	sets: Array<ExerciseSet>;
	alreadyDoneSets: Array<AlreadyDoneExerciseSet>;
	restTimer?: { enabled: boolean; duration: number } | null;
	videos: string[];
	images: string[];
}>;

type InProgressWorkout = Immutable<{
	startTime: string;
	endTime?: string;
	name: string;
	comment?: string;
	exercises: Array<Exercise>;
	videos: Array<string>;
	images: Array<string>;
	// TODO: Superset support pending
	// supersets: Array<Array<number>>;
}>;

export const currentWorkoutAtom = atomWithStorage<InProgressWorkout | null>(
	"currentWorkoutAtom",
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

export const currentWorkoutToCreateWorkoutInput = (
	currentWorkout: InProgressWorkout,
) => {
	const input: CreateUserWorkoutMutationVariables = {
		input: {
			endTime: new Date(),
			startTime: new Date(currentWorkout.startTime),
			name: currentWorkout.name
				? currentWorkout.name
				: `${getTimeOfDay(new Date())} Workout`,
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
				sets.push({ lot: set.lot, statistic: set.statistic });
			}
		if (sets.length === 0) continue;
		const notes = Array<string>();
		for (const note of exercise.notes) if (note) notes.push(note);
		input.input.exercises.push({
			exerciseId: exercise.exerciseId,
			notes,
			sets,
			assets: { images: [...exercise.images], videos: [...exercise.videos] },
		});
	}
	return input;
};

type Timer = {
	totalTime: number;
	remainingTime: number;
};

export const timerAtom = atomWithReset<Timer | null>(null);
