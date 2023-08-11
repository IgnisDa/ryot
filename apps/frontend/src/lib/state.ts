import { atomWithStorage } from "jotai/utils";

export const currentWorkoutAtom = atomWithStorage<{ startTime: string } | null>(
	"currentWorkoutAtom",
	null,
);
