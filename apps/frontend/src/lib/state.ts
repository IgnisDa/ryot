import { createId } from "@paralleldrive/cuid2";
import { atomWithStorage } from "jotai/utils";

type Exercise = {
	exercise_id: number;
};

type InProgressWorkout = {
	identifier: string;
	startTime: string;
	name: string;
	comment?: string;
	exercises: Exercise[];
	supersets: number[][];
};

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
