import { dayjsLib } from "~/lib/common";
import type {
	CurrentWorkoutStopwatch,
	InProgressWorkout,
} from "~/lib/state/fitness";

export const formatTimerDuration = (duration: number) =>
	dayjsLib.duration(duration).format("mm:ss");

export const getStopwatchMilliSeconds = (
	currentStopwatch: CurrentWorkoutStopwatch,
) => {
	if (!currentStopwatch) return 0;
	let total = 0;
	for (const duration of currentStopwatch) {
		total += dayjsLib(duration.to).diff(duration.from);
	}
	return total;
};

export const getGlobalSetIndex = (
	setIdx: number,
	exerciseIdx: number,
	currentWorkout: InProgressWorkout,
) => {
	const exerciseId = currentWorkout.exercises[exerciseIdx].exerciseId;
	let globalIndex = 0;
	for (let i = 0; i < currentWorkout.exercises.length; i++) {
		if (i === exerciseIdx) break;
		if (currentWorkout.exercises[i].exerciseId === exerciseId) {
			globalIndex += currentWorkout.exercises[i].sets.length;
		}
	}
	globalIndex += setIdx;
	return globalIndex;
};
