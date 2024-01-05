import { useAutoAnimate } from "@formkit/auto-animate/react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Button,
	Container,
	Divider,
	Drawer,
	Flex,
	Group,
	Image,
	Menu,
	Modal,
	NumberInput,
	Paper,
	Progress,
	RingProgress,
	ScrollArea,
	SimpleGrid,
	Skeleton,
	Stack,
	Switch,
	Text,
	TextInput,
	Textarea,
	ThemeIcon,
	Transition,
	UnstyledButton,
	rem,
} from "@mantine/core";
import { useDisclosure, useInterval, useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
	redirect,
} from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
	CreateUserWorkoutDocument,
	DeleteS3ObjectDocument,
	ExerciseLot,
	ExerciseSortBy,
	SetLot,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	displayWeightWithUnit,
	snakeCase,
	startCase,
	sum,
} from "@ryot/ts-utils";
import {
	IconCamera,
	IconCameraRotate,
	IconCheck,
	IconClipboard,
	IconDotsVertical,
	IconInfoCircle,
	IconLayersIntersect,
	IconPhoto,
	IconTrash,
	IconZzz,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { parse, serialize } from "cookie";
import { Howl } from "howler";
import { produce } from "immer";
import { useAtom } from "jotai";
import { RESET } from "jotai/utils";
import Cookies from "js-cookie";
import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";
import { confirmWrapper } from "~/components/confirmation";
import { DisplayExerciseStats } from "~/components/fitness";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import {
	COOKIES_KEYS,
	LOCAL_STORAGE_KEYS,
	dayjsLib,
	getPresignedGetUrl,
	getSetColor,
	gqlClientSide,
	uploadFileAndGetKey,
} from "~/lib/generals";
import {
	getCoreDetails,
	getCoreEnabledFeatures,
	getUserPreferences,
} from "~/lib/graphql.server";
import { createToastHeaders, redirectWithToast } from "~/lib/toast.server";
import { combineHeaders } from "~/lib/utilities.server";
import {
	Exercise,
	ExerciseSet,
	currentWorkoutAtom,
	currentWorkoutToCreateWorkoutInput,
	timerAtom,
} from "~/lib/workout";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const cookies = request.headers.get("Cookie");
	const inProgress =
		parse(cookies || "")[COOKIES_KEYS.isWorkoutInProgress] === "true";
	if (!inProgress)
		return redirectWithToast($path("/"), {
			type: "error",
			message: "No workout in progress",
		});
	const [coreDetails, userPreferences, coreEnabledFeatures] = await Promise.all(
		[getCoreDetails(), getUserPreferences(request), getCoreEnabledFeatures()],
	);
	return json({
		coreDetails,
		userPreferences: {
			unitSystem: userPreferences.fitness.exercises.unitSystem,
		},
		coreEnabledFeatures: { fileStorage: coreEnabledFeatures.fileStorage },
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Current Workout | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	const workout = JSON.parse(formData.get("workout") as string);
	const { createUserWorkout } = await gqlClient.request(
		CreateUserWorkoutDocument,
		workout,
		await getAuthorizationHeader(request),
	);
	return redirect($path("/fitness/workouts/:id", { id: createUserWorkout }), {
		headers: combineHeaders(
			{
				"Set-Cookie": serialize(COOKIES_KEYS.isWorkoutInProgress, "", {
					expires: new Date(0),
					sameSite: "strict",
					secure: true,
				}),
			},
			await createToastHeaders({
				message: "Workout completed successfully",
				type: "success",
			}),
		),
	});
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [parent] = useAutoAnimate();
	const navigate = useNavigate();
	const [time, setTime] = useState(0);
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const playCompleteTimerSound = () => {
		const sound = new Howl({
			src: ["/timer-completed.mp3"],
		});
		sound.play();
	};
	const [
		timerDrawerOpened,
		{
			close: timerDrawerClose,
			toggle: timerDrawerToggle,
			open: timerDrawerOpen,
		},
	] = useDisclosure(false);
	const [
		reorderDrawerOpened,
		{ close: reorderDrawerClose, toggle: reorderDrawerToggle },
	] = useDisclosure(false);
	const [currentTimer, setCurrentTimer] = useAtom(timerAtom);
	const interval = useInterval(() => {
		setTime((s) => s + 1);
	}, 1000);

	const startTimer = (
		duration: number,
		triggeredBy?: { exerciseIdentifier: string; setIdx: number },
	) => {
		setCurrentTimer({
			totalTime: duration,
			endAt: dayjsLib().add(duration, "second"),
			triggeredBy: triggeredBy,
		});
		interval.stop();
		interval.start();
	};

	const stopTimer = () => setCurrentTimer(RESET);

	const createUserWorkoutFetcher = useFetcher();

	useEffect(() => {
		const timeRemaining = currentTimer?.endAt.diff(dayjsLib(), "second");
		if (timeRemaining && timeRemaining <= 3) {
			navigator.vibrate(200);
			if (timeRemaining <= 1) {
				playCompleteTimerSound();
				timerDrawerClose();
				stopTimer();
			}
		}
	}, [time]);

	useEffect(() => {
		interval.stop();
		interval.start();
		return interval.stop;
	}, []);

	return (
		<Container size="sm">
			{currentWorkout ? (
				<ClientOnly fallback={<Text>Loading workout...</Text>}>
					{() => (
						<>
							<TimerDrawer
								opened={timerDrawerOpened}
								onClose={timerDrawerClose}
								startTimer={startTimer}
								stopTimer={stopTimer}
							/>
							<ReorderDrawer
								opened={reorderDrawerOpened}
								onClose={reorderDrawerClose}
								// biome-ignore lint/suspicious/noExplicitAny: weird errors otherwise
								exercises={currentWorkout.exercises as any}
								key={currentWorkout.exercises.toString()}
							/>
							<Stack ref={parent}>
								<TextInput
									size="sm"
									label="Name"
									placeholder="A name for your workout"
									value={currentWorkout.name}
									required
									onChange={(e) =>
										setCurrentWorkout(
											produce(currentWorkout, (draft) => {
												draft.name = e.currentTarget.value;
											}),
										)
									}
								/>
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
								<Group>
									<DurationTimer startTime={currentWorkout.startTime} />
									<StatDisplay
										name="Exercises"
										value={`${
											currentWorkout.exercises
												.map((e) => e.sets.every((s) => s.confirmed))
												.filter(Boolean).length
										}/${currentWorkout.exercises.length}`}
									/>
									<StatDisplay
										name="Weight"
										value={`${displayWeightWithUnit(
											loaderData.userPreferences.unitSystem,
											sum(
												currentWorkout.exercises
													.flatMap((e) => e.sets)
													.flatMap((s) =>
														s.confirmed
															? Number(s.statistic.reps || 0) *
															  Number(s.statistic.weight || 0)
															: 0,
													),
											).toFixed(),
										)}`}
									/>
									<StatDisplay
										name="Sets"
										value={sum(
											currentWorkout.exercises
												.flatMap((e) => e.sets)
												.flatMap((s) => (s.confirmed ? 1 : 0)),
										).toString()}
									/>
								</Group>
								<Divider />
								<SimpleGrid
									cols={
										2 +
										Number(currentWorkout.exercises.length > 0) +
										Number(currentWorkout.exercises.length > 1)
									}
								>
									<Button
										color="orange"
										variant="subtle"
										onClick={timerDrawerToggle}
										radius="md"
										size="compact-md"
									>
										{currentTimer
											? dayjsLib
													.duration(currentTimer.endAt.diff(dayjsLib()))
													.format("m:ss")
											: "Timer"}
									</Button>
									{currentWorkout.exercises.length > 1 ? (
										<>
											<Button
												color="blue"
												variant="subtle"
												onClick={reorderDrawerToggle}
												radius="md"
												size="compact-md"
											>
												Reorder
											</Button>
										</>
									) : null}
									{currentWorkout.exercises.length > 0 ? (
										<>
											<Button
												color="green"
												variant="subtle"
												radius="md"
												size="compact-md"
												onClick={async () => {
													if (!currentWorkout.name) {
														notifications.show({
															color: "red",
															message: "Please give a name to the workout",
														});
														return;
													}
													const yes = await confirmWrapper({
														title: "Finish workout",
														confirmation:
															"Only sets marked as confirmed will be recorded. Are you sure you want to finish this workout?",
													});
													if (yes) {
														const input =
															currentWorkoutToCreateWorkoutInput(
																currentWorkout,
															);
														stopTimer();
														interval.stop();
														createUserWorkoutFetcher.submit(
															{ workout: JSON.stringify(input) },
															{ method: "post" },
														);
													}
												}}
											>
												Finish
											</Button>
										</>
									) : null}
									<Button
										color="red"
										variant="subtle"
										radius="md"
										size="compact-md"
										onClick={async () => {
											const yes = await confirmWrapper({
												confirmation:
													"Are you sure you want to cancel this workout?",
											});
											if (yes) {
												navigate($path("/"));
												Cookies.remove(COOKIES_KEYS.isWorkoutInProgress);
												setCurrentWorkout(RESET);
											}
										}}
									>
										Cancel
									</Button>
								</SimpleGrid>
								<Divider />
								{currentWorkout.exercises.map((ex, idx) => (
									<ExerciseDisplay
										key={ex.identifier}
										exercise={ex}
										exerciseIdx={idx}
										startTimer={startTimer}
										stopTimer={stopTimer}
										openTimerDrawer={timerDrawerOpen}
									/>
								))}
								<Group justify="center">
									<Button
										component={Link}
										variant="subtle"
										to={$path("/fitness/exercises/list", {
											selectionEnabled: true,
											page: 1,
											sort: ExerciseSortBy.NumTimesPerformed,
										})}
									>
										Add exercise
									</Button>
								</Group>
							</Stack>
						</>
					)}
				</ClientOnly>
			) : null}
		</Container>
	);
}

const StatDisplay = (props: { name: string; value: string }) => {
	return (
		<Box mx="auto">
			<Text ta="center" fz={{ md: "xl" }}>
				{props.value}
			</Text>
			<Text c="dimmed" size="sm">
				{props.name}
			</Text>
		</Box>
	);
};

const offsetDate = (startTime: string) => {
	const now = dayjsLib();
	return now.diff(dayjsLib(startTime), "seconds");
};

const DurationTimer = ({ startTime }: { startTime: string }) => {
	const [seconds, setSeconds] = useState(offsetDate(startTime));
	const interval = useInterval(() => setSeconds((s) => s + 1), 1000);

	useEffect(() => {
		interval.start();
		return () => interval.stop();
	}, []);

	let format = "mm:ss";
	if (seconds > 3600) format = `H:${format}`;

	return (
		<StatDisplay
			name="Duration"
			value={dayjsLib.duration(seconds * 1000).format(format)}
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
							const value = v === "" ? undefined : Number(v);
							draft.exercises[props.exerciseIdx].sets[props.setIdx].statistic[
								props.stat
							] = value as unknown as null;
							if (value === undefined)
								draft.exercises[props.exerciseIdx].sets[
									props.setIdx
								].confirmed = false;
						}),
					);
				}}
				onFocus={(e) => e.target.select()}
				size="xs"
				styles={{ input: { fontSize: 15, width: rem(72) } }}
				ta="center"
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
	) : null;
};

const fileType = "image/jpeg";

const ImageDisplay = (props: {
	imageKey: string;
	removeImage: (imageKey: string) => void;
}) => {
	const imageUrl = useQuery({
		queryKey: ["presignedUrl", props.imageKey],
		queryFn: async () => {
			return await getPresignedGetUrl(props.imageKey);
		},
		staleTime: Infinity,
	});

	return imageUrl.data ? (
		<Box pos="relative">
			<Avatar src={imageUrl.data} size="lg" />
			<ActionIcon
				pos="absolute"
				top={0}
				left={-12}
				color="red"
				size="xs"
				onClick={async () => {
					const yes = confirm("Are you sure you want to remove this image?");
					if (yes) {
						const { deleteS3Object } = await gqlClientSide.request(
							DeleteS3ObjectDocument,
							{ key: props.imageKey },
						);
						if (deleteS3Object) props.removeImage(props.imageKey);
					}
				}}
			>
				<IconTrash />
			</ActionIcon>
		</Box>
	) : null;
};

const SupersetExerciseModal = (props: {
	exerciseIdx: number;
	exerciseIdentifier: string;
	opened: boolean;
	onClose: () => void;
}) => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	return currentWorkout ? (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
		>
			<Stack>
				<Text size="lg">
					Superset {currentWorkout.exercises[props.exerciseIdx].exerciseId}{" "}
					with:
				</Text>
				{currentWorkout.exercises.map((e) => (
					<Switch
						key={e.identifier}
						disabled={e.identifier === props.exerciseIdentifier}
						onChange={(event) => {
							setCurrentWorkout(
								produce(currentWorkout, (draft) => {
									const otherExercise = draft.exercises.find(
										(ex) => ex.identifier === e.identifier,
									);
									if (!otherExercise) return;
									const supersetWith =
										draft.exercises[props.exerciseIdx].supersetWith;
									if (event.currentTarget.checked) {
										supersetWith.push(e.identifier);
										otherExercise.supersetWith.push(
											currentWorkout.exercises[props.exerciseIdx].identifier,
										);
									} else {
										draft.exercises[props.exerciseIdx].supersetWith =
											supersetWith.filter((s) => s !== e.identifier);
										otherExercise.supersetWith =
											otherExercise.supersetWith.filter(
												(s) =>
													s !==
													currentWorkout.exercises[props.exerciseIdx]
														.identifier,
											);
									}
								}),
							);
						}}
						label={e.exerciseId}
						defaultChecked={currentWorkout.exercises[
							props.exerciseIdx
						].supersetWith.includes(e.identifier)}
					/>
				))}
			</Stack>
		</Modal>
	) : null;
};

const ExerciseDisplay = (props: {
	exerciseIdx: number;
	exercise: Exercise;
	startTimer: (
		duration: number,
		triggeredBy: { exerciseIdentifier: string; setIdx: number },
	) => void;
	openTimerDrawer: () => void;
	stopTimer: () => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [parent] = useAutoAnimate();
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const [currentTimer] = useAtom(timerAtom);
	const playCheckSound = () => {
		const sound = new Howl({
			src: ["/check.mp3"],
		});
		sound.play();
	};
	const [
		restTimerModalOpened,
		{ close: restTimerModalClose, toggle: restTimerModalToggle },
	] = useDisclosure(false);
	const [cameraFacing, setCameraFacing] = useState<"user" | "environment">(
		"environment",
	);
	const webcamRef = useRef<Webcam>(null);
	const [
		assetsModalOpened,
		{ close: assetsModalClose, toggle: assetsModalToggle },
	] = useDisclosure(false);
	const [exerciseDetailsOpened, { toggle: exerciseDetailsToggle }] =
		useDisclosure(false);
	const [
		supersetModalOpened,
		{ close: supersetModalClose, toggle: supersetModalToggle },
	] = useDisclosure(false);

	const [durationCol, distanceCol, weightCol, repsCol] = match(
		props.exercise.lot,
	)
		.with(ExerciseLot.DistanceAndDuration, () => [true, true, false, false])
		.with(ExerciseLot.Duration, () => [true, false, false, false])
		.with(ExerciseLot.RepsAndWeight, () => [false, false, true, true])
		.with(ExerciseLot.Reps, () => [false, false, false, true])
		.exhaustive();

	const toBeDisplayedColumns =
		[durationCol, distanceCol, weightCol, repsCol].filter(Boolean).length + 1;

	return currentWorkout ? (
		<>
			<SupersetExerciseModal
				exerciseIdx={props.exerciseIdx}
				exerciseIdentifier={props.exercise.identifier}
				opened={supersetModalOpened}
				onClose={supersetModalClose}
			/>
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
									const defaultDuration = parseInt(
										localStorage.getItem(
											LOCAL_STORAGE_KEYS.defaultExerciseRestTimer,
										) || "20",
									);
									draft.exercises[props.exerciseIdx].restTimer = {
										enabled: v.currentTarget.checked,
										duration:
											props.exercise.restTimer?.duration ?? defaultDuration,
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
									const value = typeof v === "number" ? v : null;
									const restTimer =
										draft.exercises[props.exerciseIdx].restTimer;
									if (restTimer && value) {
										restTimer.duration = value;
										localStorage.setItem(
											LOCAL_STORAGE_KEYS.defaultExerciseRestTimer,
											value.toString(),
										);
									}
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
							input: { width: "90px" },
						}}
						ta="right"
					/>
				</Stack>
			</Modal>
			<Modal
				opened={assetsModalOpened}
				onClose={assetsModalClose}
				withCloseButton={false}
			>
				<Stack>
					<Text size="lg">Images for {props.exercise.exerciseId}</Text>
					{loaderData.coreEnabledFeatures.fileStorage ? (
						<>
							{props.exercise.images.length > 0 ? (
								<Avatar.Group spacing="xs">
									{props.exercise.images.map((i) => (
										<ImageDisplay
											key={i}
											imageKey={i}
											removeImage={() => {
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														draft.exercises[props.exerciseIdx].images =
															draft.exercises[props.exerciseIdx].images.filter(
																(image) => image !== i,
															);
													}),
												);
											}}
										/>
									))}
								</Avatar.Group>
							) : null}
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
										<IconCameraRotate size={32} />
									</ActionIcon>
									<ActionIcon
										size="xl"
										onClick={async () => {
											const imageSrc = webcamRef.current?.getScreenshot();
											if (imageSrc) {
												const buffer = Buffer.from(
													imageSrc.replace(/^data:image\/\w+;base64,/, ""),
													"base64",
												);
												const uploadedKey = await uploadFileAndGetKey(
													"image.jpeg",
													"workouts",
													fileType,
													buffer,
												);
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														draft.exercises[props.exerciseIdx].images.push(
															uploadedKey,
														);
													}),
												);
											}
										}}
									>
										<IconCamera size={32} />
									</ActionIcon>
								</Stack>
							</Group>
							<Button fullWidth variant="outline" onClick={assetsModalClose}>
								Done
							</Button>
						</>
					) : (
						<Text c="red" size="sm">
							Please set the S3 variables required to enable file uploading
						</Text>
					)}
				</Stack>
			</Modal>
			<Paper px={{ base: 4, md: "xs", lg: "sm" }}>
				<Stack>
					<Menu shadow="md" width={200} position="left-end">
						<Stack>
							<Group justify="space-between" pos="relative" wrap="nowrap">
								<Anchor
									component={Link}
									to={$path("/fitness/exercises/:id", {
										id: props.exercise.exerciseId,
									})}
									fw="bold"
									lineClamp={1}
								>
									{props.exercise.exerciseId}
								</Anchor>
								<Menu.Target>
									<ActionIcon color="blue" mr={-10}>
										<IconDotsVertical />
									</ActionIcon>
								</Menu.Target>
								{currentTimer?.triggeredBy?.exerciseIdentifier ===
								props.exercise.identifier ? (
									<Progress
										pos="absolute"
										color="violet"
										bottom={-6}
										value={
											(currentTimer.endAt.diff(dayjsLib(), "seconds") * 100) /
											currentTimer.totalTime
										}
										size="xs"
										radius="md"
										w="100%"
										onClick={props.openTimerDrawer}
										style={{ cursor: "pointer" }}
									/>
								) : null}
							</Group>
							{currentWorkout.exercises[props.exerciseIdx].notes.map(
								(n, idx) => (
									<Flex
										key={`${
											currentWorkout.exercises[props.exerciseIdx].identifier
										}-${idx}`}
										align="center"
										gap="xs"
									>
										<Textarea
											style={{ flexGrow: 1 }}
											placeholder="Add a note"
											size="xs"
											minRows={1}
											maxRows={4}
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
												if (
													currentWorkout.exercises[props.exerciseIdx].notes[idx]
												) {
													const yes = confirm(
														"This note will be deleted. Are you sure you want to continue?",
													);
													if (yes)
														setCurrentWorkout(
															produce(currentWorkout, (draft) => {
																draft.exercises[props.exerciseIdx].notes.splice(
																	idx,
																	1,
																);
															}),
														);
												}
											}}
										>
											<IconTrash size={20} />
										</ActionIcon>
									</Flex>
								),
							)}
						</Stack>
						<Menu.Dropdown>
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
								leftSection={<IconClipboard size={14} />}
								rightSection={
									props.exercise.notes.length > 0
										? props.exercise.notes.length
										: null
								}
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
								leftSection={<IconLayersIntersect size={14} />}
								onClick={supersetModalToggle}
								rightSection={
									currentWorkout.exercises[props.exerciseIdx].supersetWith
										.length > 0
										? currentWorkout.exercises[props.exerciseIdx].supersetWith
												.length
										: "Off"
								}
							>
								Superset
							</Menu.Item>
							<Menu.Item
								leftSection={<IconPhoto size={14} />}
								rightSection={
									props.exercise.images.length > 0
										? props.exercise.images.length
										: null
								}
								onClick={assetsModalToggle}
							>
								Images
							</Menu.Item>
							{props.exercise.exerciseDetails.images.length > 0 ? (
								<Menu.Item
									leftSection={<IconInfoCircle size={14} />}
									onClick={exerciseDetailsToggle}
								>
									{exerciseDetailsOpened ? "Hide" : "Show"} details
								</Menu.Item>
							) : null}
							<Menu.Item
								color="red"
								leftSection={<IconTrash size={14} />}
								onClick={() => {
									const yes = confirm(
										`This removes '${props.exercise.exerciseId}' and all its sets from your workout. You can not undo this action. Are you sure you want to continue?`,
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
					<Box ref={parent}>
						{exerciseDetailsOpened ? (
							<ScrollArea mb="md" type="scroll">
								<Group wrap="nowrap">
									{props.exercise.exerciseDetails.images.map((i) => (
										<Image key={i} radius="md" src={i} h={200} w={350} />
									))}
								</Group>
							</ScrollArea>
						) : null}
						<Flex justify="space-between" align="center" mb="xs">
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
							) : null}
							{distanceCol ? (
								<Text size="xs" style={{ flex: 1 }} ta="center">
									DISTANCE (
									{match(loaderData.userPreferences.unitSystem)
										.with(UserUnitSystem.Metric, () => "KM")
										.with(UserUnitSystem.Imperial, () => "MI")
										.exhaustive()}
									)
								</Text>
							) : null}
							{weightCol ? (
								<Text size="xs" style={{ flex: 1 }} ta="center">
									WEIGHT (
									{match(loaderData.userPreferences.unitSystem)
										.with(UserUnitSystem.Metric, () => "KG")
										.with(UserUnitSystem.Imperial, () => "LB")
										.exhaustive()}
									)
								</Text>
							) : null}
							{repsCol ? (
								<Text size="xs" style={{ flex: 1 }} ta="center">
									REPS
								</Text>
							) : null}
							<Box w="10%" />
						</Flex>
						{props.exercise.sets.map((s, idx) => (
							<Flex
								key={`${props.exercise.identifier}-${idx}`}
								justify="space-between"
								align="center"
								py={4}
							>
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
												const yes = match(s.confirmed)
													.with(true, () => {
														return confirm(
															"Are you sure you want to delete this set?",
														);
													})
													.with(false, () => true)
													.exhaustive();
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
											Delete
										</Menu.Item>
									</Menu.Dropdown>
								</Menu>
								<Box w={`${85 / toBeDisplayedColumns}%`} ta="center">
									{props.exercise.alreadyDoneSets[idx] ? (
										<DisplayExerciseStats
											statistic={props.exercise.alreadyDoneSets[idx].statistic}
											lot={props.exercise.lot}
											hideExtras
											centerText
											unit={loaderData.userPreferences.unitSystem}
										/>
									) : (
										"—"
									)}
								</Box>
								{durationCol ? (
									<StatInput
										exerciseIdx={props.exerciseIdx}
										setIdx={idx}
										stat="duration"
										inputStep={0.1}
									/>
								) : null}
								{distanceCol ? (
									<StatInput
										exerciseIdx={props.exerciseIdx}
										setIdx={idx}
										stat="distance"
										inputStep={0.01}
									/>
								) : null}
								{weightCol ? (
									<StatInput
										exerciseIdx={props.exerciseIdx}
										setIdx={idx}
										stat="weight"
									/>
								) : null}
								{repsCol ? (
									<StatInput
										exerciseIdx={props.exerciseIdx}
										setIdx={idx}
										stat="reps"
									/>
								) : null}
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
															ExerciseLot.Reps,
															() => typeof s.statistic.reps === "number",
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
													const newConfirmed = !s.confirmed;
													if (
														!newConfirmed &&
														currentTimer?.triggeredBy?.exerciseIdentifier ===
															props.exercise.identifier &&
														currentTimer?.triggeredBy?.setIdx === idx
													)
														props.stopTimer();
													if (
														props.exercise.restTimer?.enabled &&
														newConfirmed &&
														s.lot !== SetLot.WarmUp
													) {
														props.startTimer(
															props.exercise.restTimer.duration,
															{
																exerciseIdentifier: props.exercise.identifier,
																setIdx: idx,
															},
														);
													}
													setCurrentWorkout(
														produce(currentWorkout, (draft) => {
															draft.exercises[props.exerciseIdx].sets[
																idx
															].confirmed = newConfirmed;
															draft.exercises[props.exerciseIdx].sets[
																idx
															].confirmedAt = dayjsLib().toISOString();
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
					</Box>
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
			<Divider />
		</>
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
										(currentTimer.endAt.diff(dayjsLib(), "seconds") * 100) /
										currentTimer.totalTime,
									color: "orange",
								},
							]}
							label={
								<>
									<Text ta="center" fz={64}>
										{dayjsLib
											.duration(currentTimer.endAt.diff(dayjsLib()))
											.format("m:ss")}
									</Text>
									<Text ta="center" c="dimmed" fz="lg" mt="-md">
										{dayjsLib
											.duration(currentTimer.totalTime * 1000)
											.format("m:ss")}
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
												draft.endAt = draft.endAt.subtract(30, "seconds");
												draft.totalTime -= 30;
											}
										}),
									);
								}}
								size="compact-lg"
								variant="outline"
								disabled={currentTimer.endAt.diff(dayjsLib(), "seconds") <= 30}
							>
								-30 sec
							</Button>
							<Button
								color="orange"
								onClick={() => {
									setCurrentTimer(
										produce(currentTimer, (draft) => {
											if (draft) {
												draft.endAt = draft.endAt.add(30, "seconds");
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
				if (draft) {
					draft.exercises = exerciseElements.map((de) =>
						// biome-ignore lint/suspicious/noExplicitAny: weird errors otherwise
						draft.exercises.find((e: any) => e.exerciseId === de.exerciseId),
					);
				}
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
									key={`${index}-${de.exerciseId}`}
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
											<Group justify="space-between" wrap="nowrap">
												<Text size="sm">{de.exerciseId}</Text>
												{currentWorkout.exercises[index].sets.every(
													(s) => s.confirmed,
												) ? (
													<ThemeIcon color="green" variant="transparent">
														<IconCheck />
													</ThemeIcon>
												) : null}
											</Group>
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
	) : null;
};
