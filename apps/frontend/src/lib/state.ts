import { atomWithStorage } from "jotai/utils";

type Exercise = {
	exercise_id: number;
};

type InProgressWorkout = {
	startTime: string;
	name?: string;
	exercises: Exercise[];
	supersets: number[][];
};

export const currentWorkoutAtom = atomWithStorage<InProgressWorkout | null>(
	"currentWorkoutAtom",
	null,
);

export const getDefaultWorkout = (): InProgressWorkout => {
	return {
		startTime: new Date().toISOString(),
		exercises: [],
		supersets: [],
	};
};
