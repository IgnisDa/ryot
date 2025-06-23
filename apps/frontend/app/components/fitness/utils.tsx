import { dayjsLib } from "~/lib/common";
import type { CurrentWorkoutStopwatch } from "~/lib/state/fitness";

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
