import { dayjsLib } from "~/lib/common";
import type { CurrentWorkoutStopwatch } from "~/lib/state/fitness";

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

export const styles = {
	body: {
		height: "80%",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	},
};

export const formatTimerDuration = (duration: number) =>
	dayjsLib.duration(duration).format("mm:ss");
