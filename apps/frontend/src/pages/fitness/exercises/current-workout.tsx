import { APP_ROUTES } from "@/lib/constants";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	type Exercise,
	type ExerciseSet,
	currentWorkoutAtom,
	currentWorkoutToCreateWorkoutInput,
	timerAtom,
} from "@/lib/state";
import { getSetColor } from "@/lib/utilities";
import {
	ActionIcon,
	Affix,
	Box,
	Button,
	Container,
	Divider,
	Drawer,
	Flex,
	Group,
	Menu,
	NumberInput,
	Paper,
	RingProgress,
	Skeleton,
	Stack,
	Text,
	TextInput,
	Textarea,
	Transition,
	UnstyledButton,
	rem,
} from "@mantine/core";
import { useDisclosure, useInterval } from "@mantine/hooks";
import {
	CreateUserWorkoutDocument,
	type CreateUserWorkoutMutationVariables,
	ExerciseLot,
	SetLot,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconCheck,
	IconClipboard,
	IconClock,
	IconDotsVertical,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { produce } from "immer";
import { useAtom } from "jotai";
import { RESET } from "jotai/utils";
import { DateTime, Duration } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { Fragment, type ReactElement, useEffect, useState } from "react";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import useSound from "use-sound";
import type { NextPageWithLayout } from "../../_app";

const StatDisplay = (props: { name: string; value: string }) => {
	return (
		<Box mx="auto">
			<Text ta="center" size="xl">
				{props.value}
			</Text>
			<Text c="dimmed" size="sm">
				{props.name}
			</Text>
		</Box>
	);
};

const offsetDate = (startTime: string) => {
	const now = DateTime.now();
	const duration = now.diff(DateTime.fromISO(startTime));
	const diff = duration.as("seconds");
	return diff;
};

const DurationTimer = ({ startTime }: { startTime: string }) => {
	const [seconds, setSeconds] = useState(offsetDate(startTime));
	const interval = useInterval(() => setSeconds((s) => s + 1), 1000);

	useEffect(() => {
		interval.start();
		return () => interval.stop();
	}, []);

	return (
		<StatDisplay
			name="Duration"
			value={Duration.fromObject({ seconds }).toFormat("mm:ss")}
		/>
	);
};

const StatInput = (props: {
	exerciseIdx: number;
	setIdx: number;
	stat: keyof ExerciseSet["statistic"];
	inputStep?: number;
}) => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	return currentWorkout ? (
		<Flex style={{ flex: 1 }} justify={"center"}>
			<NumberInput
				value={
					currentWorkout.exercises[props.exerciseIdx].sets[props.setIdx]
						.statistic[props.stat]
				}
				onChange={(v) => {
					setCurrentWorkout(
						produce(currentWorkout, (draft) => {
							const value = typeof v === "number" ? v : undefined;
							draft.exercises[props.exerciseIdx].sets[props.setIdx].statistic[
								props.stat
							] = value;
							if (value === undefined)
								draft.exercises[props.exerciseIdx].sets[
									props.setIdx
								].confirmed = false;
						}),
					);
				}}
				size="xs"
				styles={{ input: { width: rem(72), textAlign: "center" } }}
				decimalScale={
					typeof props.inputStep === "number"
						? Math.log10(1 / props.inputStep)
						: undefined
				}
				step={props.inputStep}
				hideControls
				required
			/>
		</Flex>
	) : undefined;
};

const ExerciseDisplay = (props: {
	exerciseIdx: number;
	exercise: Exercise;
}) => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const userPreferences = useUserPreferences();
	const [playCheckSound] = useSound("/pop.mp3", { interrupt: true });

	const [durationCol, distanceCol, weightCol, repsCol] = match(
		props.exercise.lot,
	)
		.with(ExerciseLot.DistanceAndDuration, () => [true, true, false, false])
		.with(ExerciseLot.Duration, () => [true, false, false, false])
		.with(ExerciseLot.RepsAndWeight, () => [false, false, true, true])
		.exhaustive();

	return userPreferences.data && currentWorkout ? (
		<Paper px="sm">
			<Stack>
				<Menu shadow="md" width={200}>
					<Stack>
						<Flex justify="space-between">
							<Text>{props.exercise.name}</Text>
							<Menu.Target>
								<ActionIcon color="blue">
									<IconDotsVertical />
								</ActionIcon>
							</Menu.Target>
						</Flex>
						{currentWorkout.exercises[props.exerciseIdx].notes.map((n, idx) => (
							<Flex key={n} align="center" gap="xs">
								<Textarea
									style={{ flexGrow: 1 }}
									placeholder="Add a note"
									size="xs"
									maxRows={1}
									autosize
									value={n}
									onChange={(e) => {
										setCurrentWorkout(
											produce(currentWorkout, (draft) => {
												draft.exercises[props.exerciseIdx].notes[idx] =
													e.currentTarget.value;
											}),
										);
									}}
								/>
								<ActionIcon
									color="red"
									onClick={() => {
										setCurrentWorkout(
											produce(currentWorkout, (draft) => {
												draft.exercises[props.exerciseIdx].notes.splice(idx, 1);
											}),
										);
									}}
								>
									<IconTrash />
								</ActionIcon>
							</Flex>
						))}
					</Stack>
					<Menu.Dropdown>
						<Menu.Item
							leftSection={<IconClipboard size={14} />}
							onClick={() => {
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										draft.exercises[props.exerciseIdx].notes.push("");
									}),
								);
							}}
						>
							Add note
						</Menu.Item>
						<Menu.Item
							color="red"
							leftSection={<IconTrash size={14} />}
							onClick={() => {
								const yes = confirm(
									`This removes '${props.exercise.name}' and all its sets from your workout. You can not undo this action. Are you sure you want to continue?`,
								);
								if (yes)
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.exercises.splice(props.exerciseIdx, 1);
										}),
									);
							}}
						>
							Remove exercise
						</Menu.Item>
					</Menu.Dropdown>
				</Menu>
				<Stack gap="xs">
					<Flex justify="space-between" align="center">
						<Text size="xs" w="5%" ta="center">
							SET
						</Text>
						{durationCol ? (
							<Text size="xs" style={{ flex: 1 }} ta="center">
								DURATION (MIN)
							</Text>
						) : undefined}
						{distanceCol ? (
							<Text size="xs" style={{ flex: 1 }} ta="center">
								DISTANCE (
								{match(userPreferences.data.fitness.exercises.unitSystem)
									.with(UserUnitSystem.Metric, () => "KM")
									.with(UserUnitSystem.Imperial, () => "MI")
									.exhaustive()}
								)
							</Text>
						) : undefined}
						{weightCol ? (
							<Text size="xs" style={{ flex: 1 }} ta="center">
								WEIGHT (
								{match(userPreferences.data.fitness.exercises.unitSystem)
									.with(UserUnitSystem.Metric, () => "KG")
									.with(UserUnitSystem.Imperial, () => "LB")
									.exhaustive()}
								)
							</Text>
						) : undefined}
						{repsCol ? (
							<Text size="xs" style={{ flex: 1 }} ta="center">
								REPS
							</Text>
						) : undefined}
						<Box w="10%" />
					</Flex>
					{props.exercise.sets.map((s, idx) => (
						<Flex key={`${idx}`} justify="space-between" align="start">
							<Menu>
								<Menu.Target>
									<UnstyledButton w="5%">
										<Text mt={2} fw="bold" c={getSetColor(s.lot)} ta="center">
											{match(s.lot)
												.with(SetLot.Normal, () => idx + 1)
												.otherwise(() => s.lot.at(0))}
										</Text>
									</UnstyledButton>
								</Menu.Target>
								<Menu.Dropdown>
									<Menu.Label>Set type</Menu.Label>
									{Object.values(SetLot).map((lot) => (
										<Menu.Item
											key={lot}
											disabled={s.lot === lot}
											fz="xs"
											leftSection={
												<Text fw="bold" fz="xs" w={10} color={getSetColor(lot)}>
													{lot.at(0)}
												</Text>
											}
											onClick={() => {
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														draft.exercises[props.exerciseIdx].sets[idx].lot =
															lot;
													}),
												);
											}}
										>
											{startCase(snakeCase(lot))}
										</Menu.Item>
									))}
									<Menu.Divider />
									<Menu.Label>Actions</Menu.Label>
									<Menu.Item
										color="red"
										fz={"xs"}
										leftSection={<IconTrash size={14} />}
										onClick={() => {
											const yes = confirm(
												"Are you sure you want to delete this set?",
											);
											if (yes)
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														draft.exercises[props.exerciseIdx].sets.splice(
															idx,
															1,
														);
													}),
												);
										}}
									>
										Delete Set
									</Menu.Item>
								</Menu.Dropdown>
							</Menu>
							{durationCol ? (
								<StatInput
									exerciseIdx={props.exerciseIdx}
									setIdx={idx}
									stat="duration"
									inputStep={0.1}
								/>
							) : undefined}
							{distanceCol ? (
								<StatInput
									exerciseIdx={props.exerciseIdx}
									setIdx={idx}
									stat="distance"
									inputStep={0.01}
								/>
							) : undefined}
							{weightCol ? (
								<StatInput
									exerciseIdx={props.exerciseIdx}
									setIdx={idx}
									stat="weight"
								/>
							) : undefined}
							{repsCol ? (
								<StatInput
									exerciseIdx={props.exerciseIdx}
									setIdx={idx}
									stat="reps"
								/>
							) : undefined}
							<Group w="10%" justify="center">
								<Transition
									mounted
									transition={{ in: {}, out: {}, transitionProperty: "all" }}
									duration={200}
									timingFunction="ease-in-out"
								>
									{(style) => (
										<ActionIcon
											variant={s.confirmed ? "filled" : "outline"}
											style={style}
											disabled={
												!match(props.exercise.lot)
													.with(
														ExerciseLot.DistanceAndDuration,
														() =>
															typeof s.statistic.distance === "number" &&
															typeof s.statistic.duration === "number",
													)
													.with(
														ExerciseLot.Duration,
														() => typeof s.statistic.duration === "number",
													)
													.with(
														ExerciseLot.RepsAndWeight,
														() =>
															typeof s.statistic.reps === "number" &&
															typeof s.statistic.weight === "number",
													)
													.exhaustive()
											}
											onMouseDown={() => playCheckSound()}
											color="green"
											onClick={() => {
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														draft.exercises[props.exerciseIdx].sets[
															idx
														].confirmed =
															!draft.exercises[props.exerciseIdx].sets[idx]
																.confirmed;
													}),
												);
											}}
										>
											<IconCheck />
										</ActionIcon>
									)}
								</Transition>
							</Group>
						</Flex>
					))}
				</Stack>
				<Button
					variant="subtle"
					onClick={() => {
						setCurrentWorkout(
							produce(currentWorkout, (draft) => {
								draft.exercises[props.exerciseIdx].sets.push({
									statistic: {},
									lot: SetLot.Normal,
									confirmed: false,
								});
							}),
						);
					}}
				>
					Add set
				</Button>
			</Stack>
		</Paper>
	) : (
		<Skeleton height={20} radius="xl" />
	);
};

const TimerDrawer = (props: {
	opened: boolean;
	onClose: () => void;
}) => {
	const [currentTimer, setCurrentTimer] = useAtom(timerAtom);
	const interval = useInterval(() => {
		setCurrentTimer((currentTimer) =>
			produce(currentTimer, (draft) => {
				if (draft) draft.remainingTime -= 1;
			}),
		);
	}, 1000);

	const startTimer = (duration: number) => {
		setCurrentTimer({
			totalTime: duration,
			remainingTime: duration,
		});
		interval.start();
	};

	useEffect(() => {
		if (
			typeof currentTimer?.remainingTime === "number" &&
			currentTimer.remainingTime <= 0
		) {
			setCurrentTimer(RESET);
			interval.stop();
		}
	}, [currentTimer]);

	useEffect(() => {
		return () => interval.stop();
	}, []);

	return (
		<Drawer
			onClose={props.onClose}
			opened={props.opened}
			withCloseButton={false}
			position="bottom"
			size={"xs"}
			styles={{
				body: {
					display: "flex",
					height: "100%",
					justifyContent: "center",
					alignItems: "center",
				},
			}}
		>
			<Stack>
				{currentTimer ? (
					<>
						<RingProgress
							size={200}
							thickness={8}
							roundCaps
							sections={[
								{
									value:
										(currentTimer.remainingTime * 100) / currentTimer.totalTime,
									color: "orange",
								},
							]}
							label={
								<>
									<Text ta="center" fz={40}>
										{Duration.fromObject({
											seconds: currentTimer.remainingTime,
										}).toFormat("m:ss")}
									</Text>
									<Text ta="center" fz={"xs"} c="dimmed">
										{Duration.fromObject({
											seconds: currentTimer.totalTime,
										}).toFormat("m:ss")}
									</Text>
								</>
							}
						/>
						<Button.Group>
							<Button
								color="orange"
								onClick={() => {
									setCurrentTimer(
										produce(currentTimer, (draft) => {
											if (draft) {
												draft.remainingTime -= 30;
												draft.totalTime -= 30;
											}
										}),
									);
								}}
								size="compact-sm"
								variant="outline"
								disabled={currentTimer.remainingTime <= 30}
							>
								-30 sec
							</Button>
							<Button
								color="orange"
								onClick={() => {
									setCurrentTimer(
										produce(currentTimer, (draft) => {
											if (draft) {
												draft.remainingTime += 30;
												draft.totalTime += 30;
											}
										}),
									);
								}}
								size="compact-sm"
								variant="outline"
							>
								+30 sec
							</Button>
							<Button
								color="orange"
								onClick={() => setCurrentTimer(RESET)}
								size="compact-sm"
							>
								Stop
							</Button>
						</Button.Group>
					</>
				) : (
					<>
						<Button
							size="compact-sm"
							variant="outline"
							onClick={() => startTimer(180)}
						>
							3 minutes
						</Button>
						<Button
							size="compact-sm"
							variant="outline"
							onClick={() => startTimer(300)}
						>
							5 minutes
						</Button>
						<Button
							size="compact-sm"
							variant="outline"
							onClick={() => startTimer(480)}
						>
							8 minutes
						</Button>
						<Button
							size="compact-sm"
							variant="outline"
							onClick={() => {
								const input = prompt("Enter duration in seconds");
								if (input) startTimer(parseInt(input));
							}}
						>
							Custom
						</Button>
					</>
				)}
			</Stack>
		</Drawer>
	);
};

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const [currentTimer] = useAtom(timerAtom);
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const [playCompleteSound] = useSound("/completed.mp3", { interrupt: true });
	const [opened, { close, toggle }] = useDisclosure(false);

	const finishWorkout = async () => {
		await router.replace(APP_ROUTES.dashboard);
		setCurrentWorkout(RESET);
	};

	const createUserWorkout = useMutation({
		mutationFn: async (input: CreateUserWorkoutMutationVariables) => {
			const { createUserWorkout } = await gqlClient.request(
				CreateUserWorkoutDocument,
				input,
			);
			return createUserWorkout;
		},
	});

	return (
		<>
			<TimerDrawer opened={opened} onClose={close} />
			<Head>
				<title>Current Workout | Ryot</title>
			</Head>
			<Container size="sm">
				<Affix position={{ bottom: rem(40), right: rem(30) }} zIndex={0}>
					<Group>
						{currentTimer ? (
							<Text fw="bold">
								{Duration.fromObject({
									seconds: currentTimer.remainingTime,
								}).toFormat("m:ss")}
							</Text>
						) : undefined}
						<ActionIcon
							color="indigo"
							variant="filled"
							radius="xl"
							size="xl"
							onClick={toggle}
						>
							<IconClock size="2rem" style={{ marginLeft: 1 }} />
						</ActionIcon>
					</Group>
				</Affix>
				{currentWorkout ? (
					<Stack>
						<Flex align="end" justify={"space-between"}>
							<TextInput
								style={{ flex: 0.7 }}
								size="sm"
								label="Name"
								placeholder="A name for your workout"
								value={currentWorkout.name}
								onChange={(e) =>
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.name = e.currentTarget.value;
										}),
									)
								}
							/>
							<DurationTimer startTime={currentWorkout.startTime} />
							<StatDisplay
								name="Exercises"
								value={currentWorkout.exercises.length.toString()}
							/>
						</Flex>
						<Textarea
							size="sm"
							minRows={2}
							label="Comment"
							placeholder="Your thoughts about this workout"
							value={currentWorkout.comment}
							onChange={(e) =>
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										draft.comment = e.currentTarget.value;
									}),
								)
							}
						/>
						<Divider />
						{currentWorkout.exercises.map((ex, idx) => (
							<Fragment key={ex.exerciseId + idx}>
								<ExerciseDisplay exercise={ex} exerciseIdx={idx} />
								<Divider />
							</Fragment>
						))}
						<Group justify="center">
							<Button
								component={Link}
								variant="subtle"
								href={withQuery(APP_ROUTES.fitness.exercises.list, {
									selectionEnabled: "yes",
								})}
							>
								Add exercise
							</Button>
						</Group>
						<Group justify="center">
							<Button
								color="red"
								variant="subtle"
								onClick={async () => {
									const yes = confirm(
										"Are you sure you want to cancel this workout?",
									);
									if (yes) await finishWorkout();
								}}
							>
								Cancel workout
							</Button>
							{currentWorkout.exercises.length > 0 ? (
								<Button
									color="green"
									variant="subtle"
									onClick={async () => {
										const yes = confirm(
											"Only sets marked as confirmed will be recorded. Are you sure you want to finish this workout?",
										);
										if (yes) {
											const input =
												currentWorkoutToCreateWorkoutInput(currentWorkout);
											createUserWorkout.mutate(input);
											playCompleteSound();
											await finishWorkout();
										}
									}}
								>
									Finish workout
								</Button>
							) : undefined}
						</Group>
					</Stack>
				) : (
					<Text>
						You do not have any workout in progress. Please start a new one from
						the dashboard.
					</Text>
				)}
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
