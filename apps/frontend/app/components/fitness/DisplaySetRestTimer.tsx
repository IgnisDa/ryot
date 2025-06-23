import { Progress } from "@mantine/core";
import { dayjsLib } from "~/lib/common";
import { forceUpdateEverySecond } from "~/lib/hooks";
import type { CurrentWorkoutTimer } from "~/lib/state/fitness";

export const DisplaySetRestTimer = (props: {
	onClick: () => void;
	currentTimer: CurrentWorkoutTimer;
}) => {
	forceUpdateEverySecond();

	return (
		<Progress
			onClick={props.onClick}
			transitionDuration={300}
			style={{ cursor: "pointer" }}
			value={
				(dayjsLib(props.currentTimer.willEndAt).diff(dayjsLib(), "seconds") *
					100) /
				props.currentTimer.totalTime
			}
		/>
	);
};
