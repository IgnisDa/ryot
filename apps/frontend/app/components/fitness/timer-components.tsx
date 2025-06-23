import { useState, useMemo } from "react";
import { useLoaderData } from "react-router";
import { produce } from "immer";
import {
	Button,
	Divider,
	Drawer,
	Group,
	RingProgress,
	Stack,
	Text,
	Box,
} from "@mantine/core";
import {
	IconDeviceWatch,
	IconDeviceWatchCancel,
	IconDeviceWatchPause,
} from "@tabler/icons-react";
import { isNumber } from "@ryot/ts-utils";
import { dayjsLib } from "~/lib/common";
import { forceUpdateEverySecond } from "~/lib/hooks";
import { useInterval } from "usehooks-ts";
import invariant from "tiny-invariant";
import {
	useCurrentWorkout,
	useCurrentWorkoutTimerAtom,
	useCurrentWorkoutStopwatchAtom,
	type CurrentWorkoutStopwatch,
} from "~/lib/state/fitness";

export const formatTimerDuration = (duration: number) =>
	dayjsLib.duration(duration).format("mm:ss");

const styles = {
	body: {
		height: "80%",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	},
};

const restTimerOptions = [180, 300, 480, "Custom"];

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

export const StatDisplay = (props: {
	name: string;
	value: string;
	isHidden?: boolean;
	onClick?: () => void;
	highlightValue?: boolean;
}) => {
	return (
		<Box
			mx="auto"
			onClick={props.onClick}
			style={{
				display: props.isHidden ? "none" : undefined,
				cursor: props.onClick ? "pointer" : undefined,
			}}
		>
			<Text
				ta="center"
				fz={{ md: "xl" }}
				c={props.highlightValue ? "red" : undefined}
			>
				{props.value}
			</Text>
			<Text c="dimmed" size="sm" ta="center">
				{props.name}
			</Text>
		</Box>
	);
};

export const WorkoutDurationTimer = (props: { isWorkoutPaused: boolean }) => {
	const { isCreatingTemplate, isUpdatingWorkout } = useLoaderData() as any;
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
			isHidden={isCreatingTemplate || isUpdatingWorkout}
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

export const TimerAndStopwatchDrawer = (props: {
	opened: boolean;
	onClose: () => void;
	stopTimer: () => void;
	pauseOrResumeTimer: () => void;
	startTimer: (duration: number) => void;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [currentTimer, setCurrentTimer] = useCurrentWorkoutTimerAtom();
	const [currentStopwatch, setCurrentStopwatch] =
		useCurrentWorkoutStopwatchAtom();

	invariant(currentWorkout);

	forceUpdateEverySecond();

	const stopwatchMilliSeconds = getStopwatchMilliSeconds(currentStopwatch);
	const isStopwatchPaused = Boolean(currentStopwatch?.at(-1)?.to);

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
									if (isNumber(option)) props.startTimer(option);
									else {
										const input = prompt("Enter duration in seconds");
										if (!input) return;
										const intInput = Number.parseInt(input);
										if (intInput) props.startTimer(intInput);
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
								size="compact-lg"
								variant="outline"
								disabled={
									dayjsLib(currentTimer.willEndAt).diff(
										currentTimer.wasPausedAt,
										"seconds",
									) <= 30
								}
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
