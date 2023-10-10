import { DisplayExerciseStats } from "@/lib/components/FitnessComponents";
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
import { getSetColor, uploadFileAndGetKey } from "@/lib/utilities";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
	ActionIcon,
	Box,
	Button,
	Container,
	Divider,
	Drawer,
	Flex,
	Group,
	Menu,
	Modal,
	NumberInput,
	Paper,
	RingProgress,
	Skeleton,
	Stack,
	Switch,
	Text,
	TextInput,
	Textarea,
	Title,
	Transition,
	UnstyledButton,
	rem,
} from "@mantine/core";
import { useDisclosure, useInterval, useListState } from "@mantine/hooks";
import {
	CreateUserWorkoutDocument,
	type CreateUserWorkoutMutationVariables,
	ExerciseLot,
	SetLot,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconCamera,
	IconCameraRotate,
	IconCheck,
	IconClipboard,
	IconDotsVertical,
	IconPhoto,
	IconTrash,
	IconZzz,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { produce } from "immer";
import { useAtom } from "jotai";
import { RESET } from "jotai/utils";
import { DateTime, Duration } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import {
	Fragment,
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import Webcam from "react-webcam";
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
		<Flex style={{ flex: 1 }} justify="center">
			<NumberInput
				value={
					currentWorkout.exercises[props.exerciseIdx].sets[props.setIdx]
						.statistic[props.stat] ?? undefined
				}
				onChange={(v) => {
					setCurrentWorkout(
						produce(currentWorkout, (draft) => {
							const value = Number(v) ?? undefined;
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

const fileType = "image/jpeg";

const ExerciseDisplay = (props: {
	exerciseIdx: number;
	exercise: Exercise;
	startTimer: (duration: number) => void;
}) => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const userPreferences = useUserPreferences();
	const [playCheckSound] = useSound("/pop.mp3", { interrupt: true });
	const [
		restTimerModalOpened,
		{ close: restTimerModalClose, toggle: restTimerModalToggle },
	] = useDisclosure(false);
	const [cameraFacing, setCameraFacing] = useState<"user" | "environment">(
		"user",
	);
	const webcamRef = useRef<Webcam>(null);
	const [
		assetsModalOpened,
		{ close: assetsModalClose, toggle: assetsModalToggle },
	] = useDisclosure(false);
	const [webcamOpened, { toggle: webcamToggle }] = useDisclosure(false);

	const [durationCol, distanceCol, weightCol, repsCol] = match(
		props.exercise.lot,
	)
		.with(ExerciseLot.DistanceAndDuration, () => [true, true, false, false])
		.with(ExerciseLot.Duration, () => [true, false, false, false])
		.with(ExerciseLot.RepsAndWeight, () => [false, false, true, true])
		.exhaustive();

	const toBeDisplayedColumns =
		[durationCol, distanceCol, weightCol, repsCol].filter(Boolean).length + 1;

	const capture = useCallback(async () => {
		const imageSrc = webcamRef.current?.getScreenshot();
		if (imageSrc) {
			const buffer = Buffer.from(
				imageSrc.replace(/^data:image\/\w+;base64,/, ""),
				"base64",
			);
			const uploadedKey = await uploadFileAndGetKey(
				"image.jpeg",
				fileType,
				buffer,
			);
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					if (draft)
						draft.exercises[props.exerciseIdx].images.push(uploadedKey);
				}),
			);
			webcamToggle();
			assetsModalClose();
		}
	}, [webcamRef]);

	return userPreferences.data && currentWorkout ? (
		<Paper px={{ base: 4, md: "xs", lg: "sm" }}>
			<Modal
				opened={restTimerModalOpened}
				onClose={restTimerModalClose}
				withCloseButton={false}
				size="xs"
			>
				<Stack>
					<Switch
						label="Enabled"
						labelPosition="left"
						styles={{ body: { justifyContent: "space-between" } }}
						defaultChecked={props.exercise.restTimer?.enabled}
						onChange={(v) => {
							setCurrentWorkout(
								produce(currentWorkout, (draft) => {
									draft.exercises[props.exerciseIdx].restTimer = {
										enabled: v.currentTarget.checked,
										duration: props.exercise.restTimer?.duration ?? 20,
									};
								}),
							);
						}}
					/>
					<NumberInput
						value={
							currentWorkout.exercises[props.exerciseIdx].restTimer?.duration
						}
						onChange={(v) => {
							setCurrentWorkout(
								produce(currentWorkout, (draft) => {
									const value = typeof v === "number" ? v : undefined;
									const restTimer =
										draft.exercises[props.exerciseIdx].restTimer;
									if (restTimer && value) restTimer.duration = value;
								}),
							);
						}}
						disabled={
							!currentWorkout.exercises[props.exerciseIdx].restTimer?.enabled
						}
						hideControls
						suffix="s"
						label="Duration"
						styles={{
							root: {
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
							},
							label: { flex: "none" },
							input: { width: "90px", textAlign: "right" },
						}}
					/>
				</Stack>
			</Modal>
			<Modal
				opened={assetsModalOpened}
				onClose={assetsModalClose}
				withCloseButton={false}
			>
				<Stack>
					<Box>
						<Title order={3}>Images and videos</Title>
						<Text c="dimmed">For {props.exercise.name}</Text>
					</Box>
					<Button.Group w="100%">
						<Button
							fullWidth
							variant="outline"
							disabled={webcamOpened}
							onClick={() => {
								webcamToggle();
							}}
						>
							{webcamOpened ? "Taking a picture" : "Upload new image"}
						</Button>
					</Button.Group>
					{webcamOpened ? (
						<Group justify="center" gap={4}>
							<Paper radius="md" style={{ overflow: "hidden" }}>
								<Webcam
									ref={webcamRef}
									height={180}
									width={240}
									videoConstraints={{ facingMode: cameraFacing }}
									screenshotFormat={fileType}
								/>
							</Paper>
							<Stack>
								<ActionIcon
									size="xl"
									onClick={() => {
										setCameraFacing(
											cameraFacing === "user" ? "environment" : "user",
										);
									}}
								>
									<IconCameraRotate size="2rem" />
								</ActionIcon>
								<ActionIcon size="xl" onClick={capture}>
									<IconCamera size="2rem" />
								</ActionIcon>
							</Stack>
						</Group>
					) : undefined}
				</Stack>
			</Modal>
			<Stack>
				{JSON.stringify(currentWorkout)}
				<Menu shadow="md" width={200} position="left-end">
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
							leftSection={<IconPhoto size={14} />}
							onClick={assetsModalToggle}
						>
							Add image/video
						</Menu.Item>
						<Menu.Item
							leftSection={<IconZzz size={14} />}
							onClick={restTimerModalToggle}
							rightSection={
								props.exercise.restTimer?.enabled
									? `${props.exercise.restTimer.duration}s`
									: "Off"
							}
						>
							Rest timer
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
							Remove
						</Menu.Item>
					</Menu.Dropdown>
				</Menu>
				<Stack gap="xs">
					<Flex justify="space-between" align="center">
						<Text size="xs" w="5%" ta="center">
							SET
						</Text>
						<Text size="xs" w={`${85 / toBeDisplayedColumns}%`} ta="center">
							PREVIOUS
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
						<Flex key={`${idx}`} justify="space-between" align="center">
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
												<Text fw="bold" fz="xs" w={10} c={getSetColor(lot)}>
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
										fz="xs"
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
							<Box w={`${85 / toBeDisplayedColumns}%`}>
								<Text ta="center" fz="xs">
									{props.exercise.alreadyDoneSets[idx] ? (
										<DisplayExerciseStats
											statistic={props.exercise.alreadyDoneSets[idx].statistic}
											lot={props.exercise.lot}
											hideExtras
										/>
									) : (
										"—"
									)}
								</Text>
							</Box>
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
											color="green"
											onClick={() => {
												playCheckSound();
												if (props.exercise.restTimer?.enabled)
													props.startTimer(props.exercise.restTimer.duration);
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
								const currentSet =
									draft.exercises[props.exerciseIdx].sets.at(-1);
								draft.exercises[props.exerciseIdx].sets.push({
									statistic: currentSet?.statistic ?? {},
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

const styles = {
	body: {
		display: "flex",
		height: "80%",
		justifyContent: "center",
		alignItems: "center",
	},
};

const TimerDrawer = (props: {
	opened: boolean;
	onClose: () => void;
	startTimer: (duration: number) => void;
	stopTimer: () => void;
}) => {
	const [currentTimer, setCurrentTimer] = useAtom(timerAtom);

	return (
		<Drawer
			onClose={props.onClose}
			opened={props.opened}
			withCloseButton={false}
			position="bottom"
			size="md"
			styles={{ body: { ...styles.body, height: "100%" } }}
		>
			<Stack align="center">
				{currentTimer ? (
					<>
						<RingProgress
							size={300}
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
									<Text ta="center" fz={64}>
										{Duration.fromObject({
											seconds: currentTimer.remainingTime,
										}).toFormat("m:ss")}
									</Text>
									<Text ta="center" c="dimmed" fz="lg" mt="-md">
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
								size="compact-lg"
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
								size="compact-lg"
								variant="outline"
							>
								+30 sec
							</Button>
							<Button
								color="orange"
								onClick={() => {
									props.onClose();
									props.stopTimer();
								}}
								size="compact-lg"
							>
								Skip
							</Button>
						</Button.Group>
					</>
				) : (
					<>
						<Button
							size="compact-xl"
							w={160}
							variant="outline"
							onClick={() => props.startTimer(180)}
						>
							3 minutes
						</Button>
						<Button
							size="compact-xl"
							w={160}
							variant="outline"
							onClick={() => props.startTimer(300)}
						>
							5 minutes
						</Button>
						<Button
							size="compact-xl"
							w={160}
							variant="outline"
							onClick={() => props.startTimer(480)}
						>
							8 minutes
						</Button>
						<Button
							size="compact-xl"
							w={160}
							variant="outline"
							onClick={() => {
								const input = prompt("Enter duration in seconds");
								if (!input) return;
								const intInput = parseInt(input);
								if (intInput) props.startTimer(intInput);
								else alert("Invalid input");
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

const ReorderDrawer = (props: {
	opened: boolean;
	onClose: () => void;
	exercises: Array<Exercise>;
}) => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const [exerciseElements, exerciseElementsHandlers] = useListState(
		props.exercises,
	);

	useEffect(() => {
		setCurrentWorkout(
			// biome-ignore lint/suspicious/noExplicitAny: weird errors otherwise
			produce(currentWorkout, (draft: any) => {
				if (draft) draft.exercises = exerciseElements;
			}),
		);
	}, [exerciseElements]);

	return currentWorkout ? (
		<Drawer
			onClose={props.onClose}
			opened={props.opened}
			size="sm"
			styles={styles}
		>
			<DragDropContext
				onDragEnd={({ destination, source }) => {
					exerciseElementsHandlers.reorder({
						from: source.index,
						to: destination?.index || 0,
					});
					props.onClose();
				}}
			>
				<Droppable droppableId="dnd-list">
					{(provided) => (
						<Stack
							{...provided.droppableProps}
							ref={provided.innerRef}
							gap="xs"
						>
							<Text c="dimmed">Hold and release to reorder exercises</Text>
							{exerciseElements.map((de, index) => (
								<Draggable
									index={index}
									draggableId={index.toString()}
									key={`${index}-${de.name}`}
								>
									{(provided) => (
										<Paper
											py={6}
											px="sm"
											radius="md"
											withBorder
											ref={provided.innerRef}
											{...provided.draggableProps}
											{...provided.dragHandleProps}
										>
											<Text>{de.name}</Text>
										</Paper>
									)}
								</Draggable>
							))}
							{provided.placeholder}
						</Stack>
					)}
				</Droppable>
			</DragDropContext>
		</Drawer>
	) : undefined;
};

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const [playCompleteWorkoutSound] = useSound("/workout-completed.wav", {
		interrupt: true,
	});
	const [
		timerDrawerOpened,
		{ close: timerDrawerClose, toggle: timerDrawerToggle },
	] = useDisclosure(false);
	const [
		reorderDrawerOpened,
		{ close: reorderDrawerClose, toggle: reorderDrawerToggle },
	] = useDisclosure(false);
	const [playCompleteTimerSound] = useSound("/timer-completed.mp3", {
		interrupt: true,
	});
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

	useEffect(() => {
		if (
			currentTimer &&
			typeof currentTimer.remainingTime === "number" &&
			currentTimer.remainingTime <= 0
		) {
			playCompleteTimerSound();
			timerDrawerClose();
			interval.stop();
			setCurrentTimer(RESET);
		}
	}, [currentTimer]);

	return (
		<>
			<Head>
				<title>Current Workout | Ryot</title>
			</Head>
			<Container size="sm">
				{currentWorkout ? (
					<Stack>
						<TimerDrawer
							opened={timerDrawerOpened}
							onClose={timerDrawerClose}
							startTimer={startTimer}
							stopTimer={() => {
								setCurrentTimer(RESET);
								interval.stop();
							}}
						/>
						<ReorderDrawer
							opened={reorderDrawerOpened}
							onClose={reorderDrawerClose}
							// biome-ignore lint/suspicious/noExplicitAny: weird errors otherwise
							exercises={currentWorkout.exercises as any}
							key={currentWorkout.exercises.toString()}
						/>
						<Flex align="end" justify="space-between">
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
						<Group justify="space-around">
							<Button
								color="orange"
								variant="subtle"
								onClick={timerDrawerToggle}
								radius="md"
							>
								{currentTimer
									? Duration.fromObject({
											seconds: currentTimer.remainingTime,
									  }).toFormat("m:ss")
									: "Timer"}
							</Button>
							{currentWorkout.exercises.length > 1 ? (
								<>
									<Button
										color="blue"
										variant="subtle"
										onClick={reorderDrawerToggle}
										radius="md"
									>
										Reorder
									</Button>
								</>
							) : undefined}
							{currentWorkout.exercises.length > 0 ? (
								<>
									<Button
										color="green"
										variant="subtle"
										radius="md"
										onClick={async () => {
											const yes = confirm(
												"Only sets marked as confirmed will be recorded. Are you sure you want to finish this workout?",
											);
											if (yes) {
												const input =
													currentWorkoutToCreateWorkoutInput(currentWorkout);
												createUserWorkout.mutate(input);
												playCompleteWorkoutSound();
												await finishWorkout();
											}
										}}
									>
										Finish
									</Button>
								</>
							) : undefined}
							<Button
								color="red"
								variant="subtle"
								radius="md"
								onClick={async () => {
									const yes = confirm(
										"Are you sure you want to cancel this workout?",
									);
									if (yes) await finishWorkout();
								}}
							>
								Cancel
							</Button>
						</Group>
						<Divider />
						{currentWorkout.exercises.map((ex, idx) => (
							<Fragment key={ex.exerciseId + idx}>
								<ExerciseDisplay
									exercise={ex}
									exerciseIdx={idx}
									startTimer={startTimer}
								/>
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
