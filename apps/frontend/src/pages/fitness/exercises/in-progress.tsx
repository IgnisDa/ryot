import type { NextPageWithLayout } from "../../_app";
import { APP_ROUTES } from "@/lib/constants";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoggedIn from "@/lib/layouts/LoggedIn";
import {
	type Exercise,
	type ExerciseSet,
	currentWorkoutAtom,
} from "@/lib/state";
import {
	ActionIcon,
	Box,
	Button,
	Container,
	Divider,
	Flex,
	Group,
	Menu,
	NumberInput,
	Paper,
	Skeleton,
	Stack,
	Text,
	TextInput,
	Textarea,
	rem,
} from "@mantine/core";
import {
	ExerciseLot,
	UserDistanceUnit,
	UserWeightUnit,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconCheck,
	IconClipboard,
	IconDotsVertical,
	IconTrash,
} from "@tabler/icons-react";
import { produce } from "immer";
import { useAtom } from "jotai";
import { RESET } from "jotai/utils";
import { DateTime, Duration } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { Fragment, type ReactElement } from "react";
import { useStopwatch } from "react-timer-hook";
import { match } from "ts-pattern";
import { withQuery } from "ufo";

const StatDisplay = (props: { name: string; value: string }) => {
	return (
		<Box mx="auto">
			<Text color="dimmed" size="sm">
				{props.name}
			</Text>
			<Text align="center" size="xl">
				{props.value}
			</Text>
		</Box>
	);
};

const offsetDate = (startTime: string) => {
	const now = DateTime.now();
	const duration = now.diff(DateTime.fromISO(startTime));
	return now.plus(duration).toJSDate();
};

const DurationTimer = ({ startTime }: { startTime: string }) => {
	const { totalSeconds } = useStopwatch({
		autoStart: true,
		offsetTimestamp: offsetDate(startTime),
	});

	return (
		<StatDisplay
			name="Duration"
			value={Duration.fromObject({ seconds: totalSeconds }).toFormat("mm:ss")}
		/>
	);
};

const StatInput = (props: {
	exerciseIdx: number;
	setIdx: number;
	stat: keyof ExerciseSet["stats"];
	inputStep?: number;
}) => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	return currentWorkout ? (
		<Flex style={{ flex: 1 }} justify={"center"}>
			<NumberInput
				onChange={(v) => {
					setCurrentWorkout(
						produce(currentWorkout, (draft) => {
							draft.exercises[props.exerciseIdx].sets[props.setIdx].stats[
								props.stat
							] = typeof v === "number" ? v : 0;
						}),
					);
				}}
				size="xs"
				styles={{ input: { width: rem(72), textAlign: "center" } }}
				step={props.inputStep}
				hideControls
				required
			/>
		</Flex>
	) : null;
};

const ExerciseDisplay = (props: {
	exerciseIdx: number;
	exercise: Exercise;
}) => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const userPreferences = useUserPreferences();

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
							<Flex key={idx} align="center" gap="xs">
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
							icon={<IconClipboard size={14} />}
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
							icon={<IconTrash size={14} />}
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
				<Stack spacing="xs">
					<Flex justify="space-between" align="center">
						<Text size="xs" w="5%" align="center">
							SET
						</Text>
						{durationCol ? (
							<Text size="xs" style={{ flex: 1 }} align="center">
								DURATION (MIN)
							</Text>
						) : null}
						{distanceCol ? (
							<Text size="xs" style={{ flex: 1 }} align="center">
								DISTANCE (
								{match(userPreferences.data.fitness.exercises.distanceUnit)
									.with(UserDistanceUnit.Kilometer, () => "KM")
									.with(UserDistanceUnit.Mile, () => "MI")
									.exhaustive()}
								)
							</Text>
						) : null}
						{weightCol ? (
							<Text size="xs" style={{ flex: 1 }} align="center">
								WEIGHT (
								{match(userPreferences.data.fitness.exercises.weightUnit)
									.with(UserWeightUnit.Kilogram, () => "KG")
									.with(UserWeightUnit.Pound, () => "LB")
									.exhaustive()}
								)
							</Text>
						) : null}
						{repsCol ? (
							<Text size="xs" style={{ flex: 1 }} align="center">
								REPS
							</Text>
						) : null}
						<Text size="xs" w="10%" align="center" />
					</Flex>
					{props.exercise.sets.map((s) => (
						<Flex key={s.idx} justify="space-between" align="start">
							<Menu>
								<Menu.Target>
									<Text
										mt={2}
										fw="bold"
										color={s.confirmed ? "green" : "blue"}
										w="5%"
										align="center"
									>
										{s.idx + 1}
									</Text>
								</Menu.Target>

								<Menu.Dropdown>
									<Menu.Item
										color="red"
										fz={"xs"}
										onClick={() => {
											const yes = confirm(
												"Are you sure you want to delete this set?",
											);
											if (yes)
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														draft.exercises[props.exerciseIdx].sets.splice(
															s.idx,
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
									setIdx={s.idx}
									stat="duration"
									inputStep={0.1}
								/>
							) : null}
							{distanceCol ? (
								<StatInput
									exerciseIdx={props.exerciseIdx}
									setIdx={s.idx}
									stat="distance"
									inputStep={0.01}
								/>
							) : null}
							{weightCol ? (
								<StatInput
									exerciseIdx={props.exerciseIdx}
									setIdx={s.idx}
									stat="weight"
								/>
							) : null}
							{repsCol ? (
								<StatInput
									exerciseIdx={props.exerciseIdx}
									setIdx={s.idx}
									stat="reps"
								/>
							) : null}
							<Group w="10%" position="center">
								<ActionIcon
									variant="outline"
									disabled={Object.values(s.stats).filter(Boolean).length === 0}
									color="green"
									onClick={() => {
										setCurrentWorkout(
											produce(currentWorkout, (draft) => {
												draft.exercises[props.exerciseIdx].sets[
													s.idx
												].confirmed =
													!draft.exercises[props.exerciseIdx].sets[s.idx]
														.confirmed;
											}),
										);
									}}
								>
									<IconCheck />
								</ActionIcon>
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
									idx: props.exercise.sets.length,
									stats: {},
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

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	const finishWorkout = async () => {
		await router.replace(APP_ROUTES.dashboard);
		setCurrentWorkout(RESET);
	};

	return (
		<>
			<Head>
				<title>Workout in progress | Ryot</title>
			</Head>
			<Container size="sm">
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
							<Fragment key={idx}>
								<ExerciseDisplay exercise={ex} exerciseIdx={idx} />
								<Divider />
							</Fragment>
						))}
						<Group position="center">
							<Link
								passHref
								legacyBehavior
								href={withQuery(APP_ROUTES.fitness.exercises.list, {
									selectionEnabled: "yes",
								})}
							>
								<Button component="a" variant="subtle">
									Add exercise
								</Button>
							</Link>
						</Group>
						<Group position="center">
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
											"Are you sure you want to finish this workout?",
										);
										if (yes) await finishWorkout();
									}}
								>
									Finish workout
								</Button>
							) : null}
						</Group>
						{JSON.stringify(currentWorkout)}
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
