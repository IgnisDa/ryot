import { produce } from "immer";
import { useMemo, useState } from "react";
import { useInterval } from "usehooks-ts";
import { dayjsLib } from "~/lib/common";
import { useCurrentWorkout } from "~/lib/state/fitness";
import { StatDisplay } from "./StatDisplay";

interface WorkoutDurationTimerProps {
	isWorkoutPaused: boolean;
	isCreatingTemplate?: boolean;
	isUpdatingWorkout?: boolean;
}

export const WorkoutDurationTimer = (props: WorkoutDurationTimerProps) => {
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
