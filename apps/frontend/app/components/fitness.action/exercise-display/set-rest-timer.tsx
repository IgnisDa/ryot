import { RingProgress, Text } from "@mantine/core";
import { dayjsLib } from "~/lib/common";
import { forceUpdateEverySecond } from "~/lib/hooks";
import { useCurrentWorkoutTimerAtom } from "~/lib/state/fitness";

export const DisplayExerciseSetRestTimer = (props: {
	openTimerDrawer: () => void;
}) => {
	const [currentTimer] = useCurrentWorkoutTimerAtom();
	forceUpdateEverySecond();

	if (!currentTimer) return null;

	return (
		<RingProgress
			size={30}
			roundCaps
			thickness={2}
			style={{ cursor: "pointer" }}
			onClick={props.openTimerDrawer}
			sections={[
				{
					value:
						(dayjsLib(currentTimer.willEndAt).diff(
							currentTimer.wasPausedAt,
							"seconds",
						) *
							100) /
						currentTimer.totalTime,
					color: "blue",
				},
			]}
			label={
				<Text ta="center" size="xs">
					{Math.floor(
						dayjsLib(currentTimer.willEndAt).diff(currentTimer.wasPausedAt) /
							1000,
					)}
				</Text>
			}
		/>
	);
};
