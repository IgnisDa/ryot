import {
	type CreateUserWorkoutMutationVariables,
	type ExerciseLot,
	type SetLot,
	type UserPreferences,
	type UserWorkoutSetRecord,
} from "@ryot/generated/graphql/backend/graphql";
import type { Immutable } from "immer";
import { atomWithStorage } from "jotai/utils";

export type ExerciseSetStats = Immutable<{
	duration?: number;
	weight?: number;
	reps?: number;
	distance?: number;
}>;

export type ExerciseSet = Immutable<{
	statistics: ExerciseSetStats;
	lot: SetLot;
	confirmed: boolean;
}>;

export type Exercise = Immutable<{
	name: string;
	exerciseId: number;
	lot: ExerciseLot;
	notes: Array<string>;
	sets: Array<ExerciseSet>;
}>;

type InProgressWorkout = Immutable<{
	startTime: string;
	endTime?: string;
	name: string;
	comment?: string;
	exercises: Array<Exercise>;
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
		// supersets: [],
	};
};

export const currentWorkoutToCreateWorkoutInput = (
	currentWorkout: InProgressWorkout,
	preferences: UserPreferences,
) => {
	const input: CreateUserWorkoutMutationVariables = {
		input: {
			endTime: new Date(),
			startTime: new Date(currentWorkout.startTime),
			name: currentWorkout.name,
			comment: currentWorkout.comment,
			supersets: [],
			exercises: [],
			distanceUnit: preferences.fitness.exercises.distanceUnit,
			weightUnit: preferences.fitness.exercises.weightUnit,
		},
	};
	for (const exercise of currentWorkout.exercises) {
		const sets = Array<UserWorkoutSetRecord>();
		for (const set of exercise.sets)
			if (set.confirmed) {
				sets.push({ lot: set.lot, statistic: set.statistics });
			}
		if (sets.length === 0) continue;
		const notes = Array<string>();
		for (const note of exercise.notes) if (note) notes.push(note);
		input.input.exercises.push({
			exerciseId: exercise.exerciseId,
			notes,
			sets,
		});
	}
	return input;
};
