import { match } from "ts-pattern";
import invariant from "tiny-invariant";
import { dayjsLib } from "~/lib/common";
import { forceUpdateEverySecond } from "~/lib/hooks";
import {
	useCurrentWorkout,
	useCurrentWorkoutStopwatchAtom,
	useCurrentWorkoutTimerAtom,
} from "~/lib/state/fitness";
import { formatTimerDuration, getStopwatchMilliSeconds } from "./utils";

export const RestTimer = () => {
	const [currentWorkout] = useCurrentWorkout();
	const [currentTimer] = useCurrentWorkoutTimerAtom();
	const [currentStopwatch] = useCurrentWorkoutStopwatchAtom();
	invariant(currentWorkout);

	forceUpdateEverySecond();

	const stopwatchMilliSeconds = getStopwatchMilliSeconds(currentStopwatch);

	return match(currentWorkout.timerDrawerLot)
		.with("timer", () =>
			currentTimer
				? formatTimerDuration(
						dayjsLib(currentTimer.willEndAt).diff(currentTimer.wasPausedAt),
					)
				: "Timer",
		)
		.with("stopwatch", () =>
			currentStopwatch
				? formatTimerDuration(stopwatchMilliSeconds)
				: "Stopwatch",
		)
		.exhaustive();
};