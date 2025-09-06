import {
	Button,
	Divider,
	Drawer,
	Group,
	RingProgress,
	Stack,
	Text,
} from "@mantine/core";
import { isNumber } from "@ryot/ts-utils";
import {
	IconDeviceWatch,
	IconDeviceWatchCancel,
	IconDeviceWatchPause,
} from "@tabler/icons-react";
import { produce } from "immer";
import invariant from "tiny-invariant";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useForceUpdateEverySecond } from "~/lib/shared/hooks";
import {
	useCurrentWorkout,
	useCurrentWorkoutStopwatchAtom,
	useCurrentWorkoutTimerAtom,
} from "~/lib/state/fitness";
import type { FuncStartTimer } from "./types";
import { formatTimerDuration, getStopwatchMilliSeconds, styles } from "./utils";

const restTimerOptions = [180, 300, 480, "Custom"];

export const TimerAndStopwatchDrawer = (props: {
	opened: boolean;
	onClose: () => void;
	stopTimer: () => void;
	startTimer: FuncStartTimer;
	pauseOrResumeTimer: () => void;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [currentTimer, setCurrentTimer] = useCurrentWorkoutTimerAtom();
	const [currentStopwatch, setCurrentStopwatch] =
		useCurrentWorkoutStopwatchAtom();

	invariant(currentWorkout);

	useForceUpdateEverySecond();

	const stopwatchMilliSeconds = getStopwatchMilliSeconds(currentStopwatch);
	const isStopwatchPaused = Boolean(currentStopwatch?.at(-1)?.to);
	const isTimerTooShortToReduce = currentTimer
		? dayjsLib(currentTimer.willEndAt).diff(
				currentTimer.wasPausedAt,
				"seconds",
			) <= 30
		: false;

	return (
		<Drawer
			size="md"
			position="bottom"
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			styles={{ body: { ...styles.body, height: "100%" } }}
		>
			<Stack align="center">
				{!currentTimer && !currentStopwatch ? (
					<>
						{restTimerOptions.map((option) => (
							<Button
								w={160}
								key={option}
								size="compact-xl"
								variant="outline"
								onClick={() => {
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.timerDrawerLot = "timer";
										}),
									);
									if (isNumber(option)) props.startTimer({ duration: option });
									else {
										const input = prompt("Enter duration in seconds");
										if (!input) return;
										const intInput = Number.parseInt(input);
										if (intInput) props.startTimer({ duration: intInput });
										else alert("Invalid input");
									}
								}}
							>
								{isNumber(option) ? `${option / 60} minutes` : option}
							</Button>
						))}
						<Divider w="150%" />
						<Button
							w={160}
							size="compact-xl"
							variant="outline"
							onClick={() => {
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										draft.timerDrawerLot = "stopwatch";
									}),
								);
								setCurrentStopwatch([{ from: dayjsLib().toISOString() }]);
							}}
						>
							Stopwatch
						</Button>
					</>
				) : null}
				{currentStopwatch ? (
					<>
						<Button
							color="orange"
							variant="outline"
							leftSection={<IconDeviceWatchCancel />}
							onClick={() => {
								setCurrentStopwatch(null);
								props.onClose();
							}}
						>
							Cancel
						</Button>
						<RingProgress
							roundCaps
							size={300}
							thickness={6}
							sections={[]}
							rootColor={isStopwatchPaused ? "gray" : "orange"}
							label={
								<Text ta="center" fz={64}>
									{formatTimerDuration(stopwatchMilliSeconds)}
								</Text>
							}
						/>
						<Button
							color="orange"
							variant="outline"
							leftSection={
								isStopwatchPaused ? (
									<IconDeviceWatch />
								) : (
									<IconDeviceWatchPause />
								)
							}
							onClick={() => {
								setCurrentStopwatch(
									produce(currentStopwatch, (draft) => {
										if (Object.keys(draft.at(-1) || {}).length === 2) {
											draft.push({ from: dayjsLib().toISOString() });
										} else {
											draft[draft.length - 1].to = dayjsLib().toISOString();
										}
									}),
								);
							}}
						>
							{isStopwatchPaused ? "Resume" : "Pause"}
						</Button>
					</>
				) : null}
				{currentTimer ? (
					<>
						<Group gap="xl">
							<Button
								color="orange"
								size="compact-lg"
								variant="outline"
								disabled={isTimerTooShortToReduce}
								onClick={() => {
									setCurrentTimer(
										produce(currentTimer, (draft) => {
											if (draft) {
												draft.willEndAt = dayjsLib(draft.willEndAt)
													.subtract(30, "seconds")
													.toISOString();
												draft.totalTime -= 30;
											}
										}),
									);
								}}
							>
								-30 sec
							</Button>
							<Button
								color="orange"
								size="compact-lg"
								variant="outline"
								onClick={() => {
									setCurrentTimer(
										produce(currentTimer, (draft) => {
											if (draft) {
												draft.willEndAt = dayjsLib(draft.willEndAt)
													.add(30, "seconds")
													.toISOString();
												draft.totalTime += 30;
											}
										}),
									);
								}}
							>
								+30 sec
							</Button>
						</Group>
						<RingProgress
							roundCaps
							size={300}
							thickness={8}
							sections={[
								{
									color: currentTimer.wasPausedAt ? "gray" : "orange",
									value:
										(dayjsLib(currentTimer.willEndAt).diff(
											currentTimer.wasPausedAt,
											"seconds",
										) *
											100) /
										currentTimer.totalTime,
								},
							]}
							label={
								<>
									<Text ta="center" fz={64}>
										{formatTimerDuration(
											dayjsLib(currentTimer.willEndAt).diff(
												currentTimer.wasPausedAt,
											),
										)}
									</Text>
									<Text ta="center" c="dimmed" fz="lg" mt="-md">
										{formatTimerDuration(currentTimer.totalTime * 1000)}
									</Text>
								</>
							}
						/>
						<Group gap="xl">
							<Button
								color="orange"
								variant="outline"
								size="compact-lg"
								onClick={() => {
									props.pauseOrResumeTimer();
								}}
							>
								{currentTimer.wasPausedAt ? "Resume" : "Pause"}
							</Button>
							<Button
								color="orange"
								variant="outline"
								size="compact-lg"
								onClick={() => {
									props.onClose();
									props.stopTimer();
								}}
							>
								Skip
							</Button>
						</Group>
					</>
				) : null}
			</Stack>
		</Drawer>
	);
};
