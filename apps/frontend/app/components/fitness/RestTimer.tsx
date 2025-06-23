import { produce } from "immer";
import { useMemo, useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useInterval } from "usehooks-ts";
import { dayjsLib } from "~/lib/common";
import { forceUpdateEverySecond } from "~/lib/hooks";
import {
	useCurrentWorkout,
	useCurrentWorkoutStopwatchAtom,
	useCurrentWorkoutTimerAtom,
} from "~/lib/state/fitness";
import { StatDisplay } from "./StatDisplayAndInput";
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

export const WorkoutDurationTimer = (props: {
	isWorkoutPaused: boolean;
	isUpdatingWorkout: boolean;
	isCreatingTemplate: boolean;
}) => {
	const [value, setValue] = useState(0);
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();

	useInterval(() => setValue((v) => v + 1), 1000);

	const seconds = useMemo(() => {
		let total = 0;
		for (const duration of currentWorkout?.durations || []) {
			total += dayjsLib(duration.to).diff(duration.from) / 1000;
		}
		return total;
	}, [value, currentWorkout]);

	if (!currentWorkout) return null;

	let format = "mm:ss";
	if (seconds > 3600) format = `H:${format}`;

	return (
		<StatDisplay
			name="Duration"
			highlightValue={props.isWorkoutPaused}
			isHidden={props.isCreatingTemplate || props.isUpdatingWorkout}
			value={dayjsLib.duration(seconds, "second").format(format)}
			onClick={() => {
				setCurrentWorkout(
					produce(currentWorkout, (draft) => {
						const currentDurations = draft.durations;
						if (Object.keys(currentDurations.at(-1) || {}).length === 2) {
							currentDurations.push({ from: dayjsLib().toISOString() });
						} else {
							currentDurations[currentDurations.length - 1].to =
								dayjsLib().toISOString();
						}
					}),
				);
			}}
		/>
	);
};
