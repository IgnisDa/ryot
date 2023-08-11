import { atomWithStorage } from "jotai/utils";

export type InProgressWorkout = {
	startTime: string;
	name?: string;
};

export const currentWorkoutAtom = atomWithStorage<InProgressWorkout | null>(
	"currentWorkoutAtom",
	null,
);
