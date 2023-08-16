import { createId } from "@paralleldrive/cuid2";
import type { ExerciseLot } from "@ryot/generated/graphql/backend/graphql";
import type { Immutable } from "immer";
import { atomWithStorage } from "jotai/utils";

export type ExerciseSetStats = Immutable<{
	duration?: number;
	weight?: number;
	reps?: number;
	distance?: number;
}>;

export type ExerciseSet = Immutable<{
	idx: number;
	stats: ExerciseSetStats;
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
	name: string;
	comment?: string;
	exercises: Array<Exercise>;
	supersets: Array<Array<number>>;
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
		supersets: [],
	};
};
