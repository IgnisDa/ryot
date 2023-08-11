import { createId } from "@paralleldrive/cuid2";
import { atomWithStorage } from "jotai/utils";

type Exercise = {
	exercise_id: number;
};

type InProgressWorkout = {
	identifier: string;
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
		identifier: createId(),
		startTime: new Date().toISOString(),
		exercises: [],
		supersets: [],
	};
};
