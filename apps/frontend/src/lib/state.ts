import { createId } from "@paralleldrive/cuid2";
import type {
	CreateUserWorkoutMutationVariables,
	ExerciseLot,
	SetLot,
	UserWorkoutSetRecord,
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
	stats: ExerciseSetStats;
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
	identifier: string;
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
		identifier: createId(),
		startTime: date.toISOString(),
		exercises: [],
		// supersets: [],
	};
};

export const currentWorkoutToCreateWorkoutInput = (
	currentWorkout: InProgressWorkout,
) => {
	const input: CreateUserWorkoutMutationVariables = {
		input: {
			endTime: new Date(),
			identifier: currentWorkout.identifier,
			startTime: new Date(currentWorkout.startTime),
			name: currentWorkout.name,
			comment: currentWorkout.comment,
			supersets: [],
			exercises: [],
		},
	};
	for (const exercise of currentWorkout.exercises) {
		const sets = Array<UserWorkoutSetRecord>();
		for (const set of exercise.sets)
			if (set.confirmed)
				sets.push({
					lot: set.lot,
					statistic: set.stats,
				});
		if (sets.length == 0) continue;
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
