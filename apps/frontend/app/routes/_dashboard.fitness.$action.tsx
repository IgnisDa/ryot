import { Buffer } from "buffer";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
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
import {
	useDebouncedState,
	useDidUpdate,
	useDisclosure,
	useListState,
	useToggle,
} from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Link,
	useFetcher,
	useLoaderData,
	useNavigate,
	useRevalidator,
} from "@remix-run/react";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import {
	CreateUserWorkoutDocument,
	ExerciseLot,
	SetLot,
	UserUnitSystem,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import {
	isEqual,
	isNumber,
	isString,
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
	IconDroplet,
	IconDropletFilled,
	IconDropletHalf2Filled,
	IconInfoCircle,
	IconLayersIntersect,
	IconPhoto,
	IconTrash,
	IconZzz,
} from "@tabler/icons-react";
import { Howl } from "howler";
import { produce } from "immer";
import { RESET } from "jotai/utils";
import Cookies from "js-cookie";
import { useRef } from "react";
import Webcam from "react-webcam";
import { $path } from "remix-routes";
import { ClientOnly } from "remix-utils/client-only";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { useInterval } from "usehooks-ts";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import {
	DisplaySetStatistics,
	displayWeightWithUnit,
} from "~/components/fitness";
import {
	CurrentWorkoutKey,
	dayjsLib,
	getSetColor,
	queryClient,
	queryFactory,
} from "~/lib/generals";
import {
	forceUpdateEverySecond,
	useApplicationEvents,
	useCoreDetails,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/hooks";
import {
	type InProgressWorkout,
	currentWorkoutToCreateWorkoutInput,
	exerciseHasDetailsToShow,
	useCurrentWorkout,
	useGetExerciseAtIndex,
	useGetSetAtIndex,
	useMeasurementsDrawerOpen,
	useTimerAtom,
} from "~/lib/state/fitness";
import {
	isWorkoutActive,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";

const workoutCookieName = CurrentWorkoutKey;
const defaultTimerLocalStorageKey = "DefaultExerciseRestTimer";

enum Action {
	LogWorkout = "log-workout",
	CreateTemplate = "create-template",
}

export const loader = unstable_defineLoader(async ({ params, request }) => {
	const { action } = zx.parseParams(params, { action: z.nativeEnum(Action) });
	await match(action)
		.with(Action.LogWorkout, async () => {
			const inProgress = isWorkoutActive(request);
			if (!inProgress)
				throw await redirectWithToast($path("/"), {
					type: "error",
					message: "No workout in progress",
				});
		})
		.with(Action.CreateTemplate, async () => {})
		.exhaustive();
	return { action, isCreatingTemplate: action === Action.CreateTemplate };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [
		{
			title: `${data?.action === Action.LogWorkout ? "Log Workout" : "Create Template"} | Ryot`,
		},
	];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	const workout = JSON.parse(formData.get("workout") as string);
	return namedAction(request, {
		createWorkout: async () => {
			const { createUserWorkout } = await serverGqlService.authenticatedRequest(
				request,
				CreateUserWorkoutDocument,
				workout,
			);
			return redirectWithToast(
				$path("/fitness/:entity/:id", {
					entity: "workouts",
					id: createUserWorkout,
				}),
				{ message: "Workout completed successfully", type: "success" },
			);
		},
	});
});

const deleteUploadedAsset = (key: string) => {
	const formData = new FormData();
	formData.append("key", key);
	fetch($path("/actions", { intent: "deleteS3Asset" }), {
		method: "POST",
		body: formData,
	});
};

export default function Page() {
	const { isCreatingTemplate } = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const events = useApplicationEvents();
	const [parent] = useAutoAnimate();
	const navigate = useNavigate();
	const revalidator = useRevalidator();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const playCompleteTimerSound = () => {
		const sound = new Howl({ src: ["/timer-completed.mp3"] });
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
	const [_, setMeasurementsDrawerOpen] = useMeasurementsDrawerOpen();
	const [currentTimer, setCurrentTimer] = useTimerAtom();

	useInterval(() => {
		const timeRemaining = currentTimer?.endAt.diff(dayjsLib(), "second");
		if (timeRemaining && timeRemaining <= 3) {
			if (navigator.vibrate) navigator.vibrate(200);
			if (timeRemaining <= 1) {
				playCompleteTimerSound();
				timerDrawerClose();
				stopTimer();
			}
		}
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
	};

	const stopTimer = () => setCurrentTimer(RESET);

	const createUserWorkoutFetcher = useFetcher<typeof action>();

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
									<DurationTimer />
									<StatDisplay
										name="Exercises"
										value={
											isCreatingTemplate
												? currentWorkout.exercises.length.toString()
												: `${
														currentWorkout.exercises
															.map((e) => e.sets.every((s) => s.confirmedAt))
															.filter(Boolean).length
													}/${currentWorkout.exercises.length}`
										}
									/>
									<StatDisplay
										name="Weight"
										value={`${displayWeightWithUnit(
											unitSystem,
											sum(
												currentWorkout.exercises
													.flatMap((e) => e.sets)
													.flatMap((s) =>
														isCreatingTemplate || s.confirmedAt
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
												.flatMap((s) =>
													isCreatingTemplate || s.confirmedAt ? 1 : 0,
												),
										).toString()}
									/>
								</Group>
								<Divider />
								<SimpleGrid
									cols={
										2 +
										(isCreatingTemplate ? -1 : 0) +
										Number(currentWorkout.exercises.length > 0) +
										Number(currentWorkout.exercises.length > 1)
									}
								>
									<Button
										radius="md"
										color="orange"
										variant="subtle"
										size="compact-sm"
										onClick={timerDrawerToggle}
										style={isCreatingTemplate ? { display: "none" } : undefined}
									>
										<RestTimer />
									</Button>
									{currentWorkout.exercises.length > 1 ? (
										<>
											<Button
												color="blue"
												variant="subtle"
												onClick={reorderDrawerToggle}
												radius="md"
												size="compact-sm"
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
												size="compact-sm"
												onClick={async () => {
													if (!currentWorkout.name) {
														notifications.show({
															color: "red",
															message: `Please give a name to the ${isCreatingTemplate ? "template" : "workout"}`,
														});
														return;
													}
													const yes = await confirmWrapper({
														confirmation: isCreatingTemplate
															? "Only sets that have data will added. Are you sure you want to save this template?"
															: "Only sets marked as confirmed will be recorded. Are you sure you want to finish this workout?",
													});
													if (yes) {
														const input = currentWorkoutToCreateWorkoutInput(
															currentWorkout,
															isCreatingTemplate,
														);
														for (const exercise of currentWorkout.exercises) {
															queryClient.removeQueries({
																queryKey:
																	queryFactory.fitness.userExerciseDetails(
																		exercise.exerciseId,
																	).queryKey,
															});
														}
														stopTimer();
														if (!isCreatingTemplate) {
															events.createWorkout();
															Cookies.remove(workoutCookieName);
														}
														createUserWorkoutFetcher.submit(
															{ workout: JSON.stringify(input) },
															{
																method: "post",
																action: withQuery(".", {
																	intent: isCreatingTemplate
																		? "createTemplate"
																		: "createWorkout",
																}),
																encType: "multipart/form-data",
															},
														);
													}
												}}
											>
												{isCreatingTemplate ? "Save" : "Finish"}
											</Button>
										</>
									) : null}
									<Button
										color="red"
										variant="subtle"
										radius="md"
										size="compact-sm"
										onClick={async () => {
											const yes = await confirmWrapper({
												confirmation: `Are you sure you want to cancel this ${isCreatingTemplate ? "template" : "workout"}?`,
											});
											if (yes) {
												for (const e of currentWorkout.exercises) {
													const assets = [...e.images, ...e.videos];
													for (const asset of assets)
														deleteUploadedAsset(asset.key);
												}
												navigate($path("/"), { replace: true });
												revalidator.revalidate();
												Cookies.remove(workoutCookieName);
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
										exerciseIdx={idx}
										startTimer={startTimer}
										stopTimer={stopTimer}
										openTimerDrawer={timerDrawerOpen}
									/>
								))}
								<Group justify="center">
									{userPreferences.featuresEnabled.fitness.measurements ? (
										<Button
											color="teal"
											variant="subtle"
											onClick={() => setMeasurementsDrawerOpen(true)}
											style={
												isCreatingTemplate ? { display: "none" } : undefined
											}
										>
											Add measurement
										</Button>
									) : null}
									<Button
										component={Link}
										variant="subtle"
										to={$path("/fitness/exercises/list")}
									>
										Add an exercise
									</Button>
								</Group>
							</Stack>
						</>
					)}
				</ClientOnly>
			) : (
				<Text>Loading {isCreatingTemplate ? "template" : "workout"}...</Text>
			)}
		</Container>
	);
}

const StatDisplay = (props: {
	name: string;
	value: string;
	isHidden?: boolean;
}) => {
	return (
		<Box mx="auto" style={props.isHidden ? { display: "none" } : undefined}>
			<Text ta="center" fz={{ md: "xl" }}>
				{props.value}
			</Text>
			<Text c="dimmed" size="sm" ta="center">
				{props.name}
			</Text>
		</Box>
	);
};

const offsetDate = (startTime?: string) => {
	const now = dayjsLib();
	return now.diff(dayjsLib(startTime), "seconds");
};

const RestTimer = () => {
	forceUpdateEverySecond();
	const [currentTimer] = useTimerAtom();

	return currentTimer
		? dayjsLib.duration(currentTimer.endAt.diff(dayjsLib())).format("m:ss")
		: "Timer";
};

const DurationTimer = () => {
	forceUpdateEverySecond();
	const [currentWorkout] = useCurrentWorkout();
	const seconds = offsetDate(currentWorkout?.startTime);
	const { isCreatingTemplate } = useLoaderData<typeof loader>();

	let format = "mm:ss";
	if (seconds > 3600) format = `H:${format}`;

	return (
		<StatDisplay
			name="Duration"
			value={dayjsLib.duration(seconds * 1000).format(format)}
			isHidden={isCreatingTemplate}
		/>
	);
};

const StatInput = (props: {
	exerciseIdx: number;
	setIdx: number;
	stat: keyof WorkoutSetStatistic;
	inputStep?: number;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	invariant(set);
	const [value, setValue] = useDebouncedState<string | number | undefined>(
		isString(set.statistic[props.stat])
			? Number(set.statistic[props.stat])
			: undefined,
		500,
	);

	useDidUpdate(() => {
		if (currentWorkout)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					const val = isString(value) ? null : value?.toString();
					const draftSet =
						draft.exercises[props.exerciseIdx].sets[props.setIdx];
					draftSet.statistic[props.stat] = val;
					if (val === null) draftSet.confirmedAt = null;
				}),
			);
	}, [value]);

	return currentWorkout ? (
		<Flex style={{ flex: 1 }} justify="center">
			<NumberInput
				required
				value={
					isString(set.statistic[props.stat])
						? Number(set.statistic[props.stat])
						: undefined
				}
				onChange={(v) => setValue(v)}
				onFocus={(e) => e.target.select()}
				size="xs"
				styles={{
					input: { fontSize: 15, width: rem(72), textAlign: "center" },
				}}
				decimalScale={
					isNumber(props.inputStep)
						? Math.log10(1 / props.inputStep)
						: undefined
				}
				step={props.inputStep}
				hideControls
			/>
		</Flex>
	) : null;
};

const fileType = "image/jpeg";

const ImageDisplay = (props: {
	imageSrc: string;
	removeImage: () => void;
}) => {
	return (
		<Box pos="relative">
			<Avatar src={props.imageSrc} size="lg" />
			<ActionIcon
				pos="absolute"
				top={0}
				left={-12}
				color="red"
				size="xs"
				onClick={async () => {
					const yes = await confirmWrapper({
						confirmation: "Are you sure you want to remove this image?",
					});
					if (yes) props.removeImage();
				}}
			>
				<IconTrash />
			</ActionIcon>
		</Box>
	);
};

const SupersetExerciseModal = (props: {
	exerciseIdx: number;
	exerciseIdentifier: string;
	opened: boolean;
	onClose: () => void;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();

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

type FuncStartTimer = (
	duration: number,
	triggeredBy: { exerciseIdentifier: string; setIdx: number },
) => void;

const ExerciseDisplay = (props: {
	exerciseIdx: number;
	startTimer: FuncStartTimer;
	openTimerDrawer: () => void;
	stopTimer: () => void;
}) => {
	const { isCreatingTemplate } = useLoaderData<typeof loader>();
	const unitSystem = useUserUnitSystem();
	const [parent] = useAutoAnimate();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const [currentTimer] = useTimerAtom();
	const coreDetails = useCoreDetails();
	const fileUploadAllowed = coreDetails.fileStorageEnabled;

	const playAddSetSound = () => {
		const sound = new Howl({ src: ["/add-set.mp3"] });
		sound.play();
	};
	const [
		restTimerModalOpened,
		{ close: restTimerModalClose, toggle: restTimerModalToggle },
	] = useDisclosure(false);
	const [cameraFacing, toggleCameraFacing] = useToggle([
		"environment",
		"user",
	] as const);
	const webcamRef = useRef<Webcam>(null);
	const [
		assetsModalOpened,
		{ close: assetsModalClose, toggle: assetsModalToggle },
	] = useDisclosure(false);
	const [
		supersetModalOpened,
		{ close: supersetModalClose, toggle: supersetModalToggle },
	] = useDisclosure(false);

	const [durationCol, distanceCol, weightCol, repsCol] = match(exercise.lot)
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
				opened={supersetModalOpened}
				onClose={supersetModalClose}
				exerciseIdx={props.exerciseIdx}
				exerciseIdentifier={exercise.identifier}
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
						defaultChecked={exercise.restTimer?.enabled}
						onChange={(v) => {
							setCurrentWorkout(
								produce(currentWorkout, (draft) => {
									const defaultDuration = Number.parseInt(
										localStorage.getItem(defaultTimerLocalStorageKey) || "20",
									);
									draft.exercises[props.exerciseIdx].restTimer = {
										enabled: v.currentTarget.checked,
										duration: exercise.restTimer?.duration ?? defaultDuration,
									};
								}),
							);
						}}
					/>
					<NumberInput
						value={exercise.restTimer?.duration}
						onChange={(v) => {
							setCurrentWorkout(
								produce(currentWorkout, (draft) => {
									const value = isNumber(v) ? v : null;
									const restTimer =
										draft.exercises[props.exerciseIdx].restTimer;
									if (restTimer && value) {
										restTimer.duration = value;
										localStorage.setItem(
											defaultTimerLocalStorageKey,
											value.toString(),
										);
									}
								}),
							);
						}}
						disabled={!exercise.restTimer?.enabled}
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
					<Text size="lg">Images for {exercise.exerciseId}</Text>
					{fileUploadAllowed ? (
						<>
							{exercise.images.length > 0 ? (
								<Avatar.Group spacing="xs">
									{exercise.images.map((i, imgIdx) => (
										<ImageDisplay
											key={i.key}
											imageSrc={i.imageSrc}
											removeImage={() => {
												deleteUploadedAsset(i.key);
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														const images =
															draft.exercises[props.exerciseIdx].images;
														images.splice(imgIdx, 1);
														draft.exercises[props.exerciseIdx].images = images;
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
									<ActionIcon size="xl" onClick={() => toggleCameraFacing()}>
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
												const fileObj = new File([buffer], "image.jpg", {
													type: fileType,
												});
												const toSubmitForm = new FormData();
												toSubmitForm.append("file", fileObj, "image.jpg");
												const resp = await fetch(
													$path("/actions", { intent: "uploadWorkoutAsset" }),
													{ method: "POST", body: toSubmitForm },
												);
												const data = await resp.json();
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														draft.exercises[props.exerciseIdx].images.push({
															imageSrc,
															key: data.key,
														});
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
			<Paper
				id={props.exerciseIdx.toString()}
				px={{ base: 4, md: "xs", lg: "sm" }}
			>
				<Stack>
					<Menu shadow="md" width={200} position="left-end">
						<Stack ref={parent}>
							<Group justify="space-between" pos="relative" wrap="nowrap">
								<Anchor
									component={Link}
									to={$path("/fitness/exercises/item/:id", {
										id: encodeURIComponent(exercise.exerciseId),
									})}
									fw="bold"
									lineClamp={1}
								>
									{exercise.exerciseId}
								</Anchor>
								<Menu.Target>
									<ActionIcon color="blue" mr={-10}>
										<IconDotsVertical />
									</ActionIcon>
								</Menu.Target>
								{currentTimer?.triggeredBy?.exerciseIdentifier ===
								exercise.identifier ? (
									<RestTimerProgress onClick={props.openTimerDrawer} />
								) : null}
							</Group>
							{exercise.notes.map((note, idx) => (
								<NoteInput
									key={`${exercise.identifier}-${idx}`}
									exerciseIdx={props.exerciseIdx}
									noteIdx={idx}
									note={note}
								/>
							))}
						</Stack>
						<Menu.Dropdown>
							<Menu.Item
								leftSection={<IconZzz size={14} />}
								onClick={restTimerModalToggle}
								rightSection={
									exercise.restTimer?.enabled
										? `${exercise.restTimer.duration}s`
										: "Off"
								}
							>
								Rest timer
							</Menu.Item>
							<Menu.Item
								leftSection={<IconClipboard size={14} />}
								rightSection={
									exercise.notes.length > 0 ? exercise.notes.length : null
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
									exercise.supersetWith.length > 0
										? exercise.supersetWith.length
										: "Off"
								}
							>
								Superset
							</Menu.Item>
							<Menu.Item
								leftSection={<IconPhoto size={14} />}
								onClick={assetsModalToggle}
								rightSection={
									exercise.images.length > 0 ? exercise.images.length : null
								}
								style={isCreatingTemplate ? { display: "none" } : undefined}
							>
								Images
							</Menu.Item>
							{exerciseHasDetailsToShow(exercise) ? (
								<Menu.Item
									leftSection={<IconInfoCircle size={14} />}
									onClick={() => {
										setCurrentWorkout(
											produce(currentWorkout, (draft) => {
												draft.exercises[props.exerciseIdx].isShowDetailsOpen =
													!exercise.isShowDetailsOpen;
											}),
										);
									}}
								>
									{exercise.isShowDetailsOpen ? "Hide" : "Show"} details
								</Menu.Item>
							) : null}
							<Menu.Item
								color="red"
								leftSection={<IconTrash size={14} />}
								onClick={async () => {
									const yes = await confirmWrapper({
										confirmation: `This removes '${exercise.exerciseId}' and all its sets from your workout. You can not undo this action. Are you sure you want to continue?`,
									});
									if (yes) {
										const assets = [...exercise.images, ...exercise.videos];
										for (const asset of assets) deleteUploadedAsset(asset.key);
										setCurrentWorkout(
											produce(currentWorkout, (draft) => {
												draft.exercises.splice(props.exerciseIdx, 1);
											}),
										);
									}
								}}
							>
								Remove
							</Menu.Item>
						</Menu.Dropdown>
					</Menu>
					<Box ref={parent}>
						{exercise.isShowDetailsOpen ? (
							<ScrollArea mb="md" type="scroll">
								<Group wrap="nowrap">
									{exercise.exerciseDetails.images.map((i) => (
										<Image key={i} radius="md" src={i} h={200} w={350} />
									))}
								</Group>
							</ScrollArea>
						) : null}
						<Flex justify="space-between" align="center" mb="xs">
							<Text size="xs" w="5%" ta="center">
								SET
							</Text>
							<Text
								size="xs"
								w={`${(isCreatingTemplate ? 95 : 85) / toBeDisplayedColumns}%`}
								ta="center"
							>
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
									{match(unitSystem)
										.with(UserUnitSystem.Metric, () => "KM")
										.with(UserUnitSystem.Imperial, () => "MI")
										.exhaustive()}
									)
								</Text>
							) : null}
							{weightCol ? (
								<Text size="xs" style={{ flex: 1 }} ta="center">
									WEIGHT (
									{match(unitSystem)
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
							<Box
								w="10%"
								style={isCreatingTemplate ? { display: "none" } : undefined}
							/>
						</Flex>
						{exercise.sets.map((_, idx) => (
							<SetDisplay
								setIdx={idx}
								repsCol={repsCol}
								weightCol={weightCol}
								distanceCol={distanceCol}
								durationCol={durationCol}
								stopTimer={props.stopTimer}
								startTimer={props.startTimer}
								exerciseIdx={props.exerciseIdx}
								key={`${exercise.identifier}-${idx}`}
								toBeDisplayedColumns={toBeDisplayedColumns}
							/>
						))}
					</Box>
					<Button
						variant="subtle"
						onClick={() => {
							playAddSetSound();
							setCurrentWorkout(
								produce(currentWorkout, (draft) => {
									const currentSet =
										draft.exercises[props.exerciseIdx].sets.at(-1);
									draft.exercises[props.exerciseIdx].sets.push({
										statistic: currentSet?.statistic ?? {},
										lot: SetLot.Normal,
										confirmedAt: null,
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
	) : null;
};

const RestTimerProgress = (props: { onClick: () => void }) => {
	const [currentTimer] = useTimerAtom();
	forceUpdateEverySecond();

	if (!currentTimer) return null;

	return (
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
			onClick={props.onClick}
			style={{ cursor: "pointer" }}
		/>
	);
};

const SetDisplay = (props: {
	setIdx: number;
	repsCol: boolean;
	weightCol: boolean;
	exerciseIdx: number;
	durationCol: boolean;
	distanceCol: boolean;
	stopTimer: () => void;
	startTimer: FuncStartTimer;
	toBeDisplayedColumns: number;
}) => {
	const { isCreatingTemplate } = useLoaderData<typeof loader>();
	const [currentTimer, _] = useTimerAtom();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	const playCheckSound = () => {
		const sound = new Howl({ src: ["/check.mp3"] });
		sound.play();
	};

	return currentWorkout && exercise && set ? (
		<Box>
			<Flex justify="space-between" align="center" py={4}>
				<Menu>
					<Menu.Target>
						<UnstyledButton w="5%">
							<Text mt={2} fw="bold" c={getSetColor(set.lot)} ta="center">
								{match(set.lot)
									.with(SetLot.Normal, () => props.setIdx + 1)
									.otherwise(() => set.lot.at(0))}
							</Text>
						</UnstyledButton>
					</Menu.Target>
					<Menu.Dropdown>
						<Menu.Label>Set type</Menu.Label>
						{Object.values(SetLot).map((lot) => (
							<Menu.Item
								key={lot}
								disabled={set.lot === lot}
								fz="xs"
								leftSection={
									<Text fw="bold" fz="xs" w={10} c={getSetColor(lot)}>
										{lot.at(0)}
									</Text>
								}
								onClick={() => {
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.exercises[props.exerciseIdx].sets[
												props.setIdx
											].lot = lot;
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
							onClick={async () => {
								const yes = await match(!!set.confirmedAt)
									.with(true, async () => {
										return confirmWrapper({
											confirmation: "Are you sure you want to delete this set?",
										});
									})
									.with(false, () => true)
									.exhaustive();
								if (yes)
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.exercises[props.exerciseIdx].sets.splice(
												props.setIdx,
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
				<Box
					w={`${(isCreatingTemplate ? 95 : 85) / props.toBeDisplayedColumns}%`}
					ta="center"
				>
					{exercise.alreadyDoneSets[props.setIdx] ? (
						<Box
							onClick={() => {
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										const idxToTarget = set.confirmedAt
											? props.setIdx + 1
											: props.setIdx;
										const setToTarget =
											draft.exercises[props.exerciseIdx].sets[idxToTarget];
										if (setToTarget)
											setToTarget.statistic =
												exercise.alreadyDoneSets[props.setIdx].statistic;
									}),
								);
							}}
							style={{ cursor: "pointer" }}
						>
							<DisplaySetStatistics
								statistic={exercise.alreadyDoneSets[props.setIdx].statistic}
								lot={exercise.lot}
								hideExtras
								centerText
							/>
						</Box>
					) : (
						"—"
					)}
				</Box>
				{props.durationCol ? (
					<StatInput
						exerciseIdx={props.exerciseIdx}
						setIdx={props.setIdx}
						stat="duration"
						inputStep={0.1}
					/>
				) : null}
				{props.distanceCol ? (
					<StatInput
						exerciseIdx={props.exerciseIdx}
						setIdx={props.setIdx}
						stat="distance"
						inputStep={0.01}
					/>
				) : null}
				{props.weightCol ? (
					<StatInput
						exerciseIdx={props.exerciseIdx}
						setIdx={props.setIdx}
						stat="weight"
					/>
				) : null}
				{props.repsCol ? (
					<StatInput
						exerciseIdx={props.exerciseIdx}
						setIdx={props.setIdx}
						stat="reps"
					/>
				) : null}
				<Group
					w="10%"
					justify="center"
					style={isCreatingTemplate ? { display: "none" } : undefined}
				>
					<Transition
						mounted
						transition={{
							in: {},
							out: {},
							transitionProperty: "all",
						}}
						duration={200}
						timingFunction="ease-in-out"
					>
						{(style) => (
							<ActionIcon
								variant={set.confirmedAt ? "filled" : "outline"}
								style={style}
								disabled={
									!match(exercise.lot)
										.with(
											ExerciseLot.DistanceAndDuration,
											() =>
												isString(set.statistic.distance) &&
												isString(set.statistic.duration),
										)
										.with(ExerciseLot.Duration, () =>
											isString(set.statistic.duration),
										)
										.with(ExerciseLot.Reps, () => isString(set.statistic.reps))
										.with(
											ExerciseLot.RepsAndWeight,
											() =>
												isString(set.statistic.reps) &&
												isString(set.statistic.weight),
										)
										.exhaustive()
								}
								color="green"
								onClick={() => {
									playCheckSound();
									const newConfirmed = !set.confirmedAt;
									if (
										!newConfirmed &&
										currentTimer?.triggeredBy?.exerciseIdentifier ===
											exercise.identifier &&
										currentTimer?.triggeredBy?.setIdx === props.setIdx
									)
										props.stopTimer();
									if (
										exercise.restTimer?.enabled &&
										newConfirmed &&
										set.lot !== SetLot.WarmUp
									) {
										props.startTimer(exercise.restTimer.duration, {
											exerciseIdentifier: exercise.identifier,
											setIdx: props.setIdx,
										});
									}
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											const currentExercise =
												draft.exercises[props.exerciseIdx];
											currentExercise.sets[props.setIdx].confirmedAt =
												newConfirmed ? dayjsLib().toISOString() : null;
										}),
									);
								}}
								data-statistics={JSON.stringify(set.statistic)}
							>
								<IconCheck />
							</ActionIcon>
						)}
					</Transition>
				</Group>
			</Flex>
		</Box>
	) : null;
};

const styles = {
	body: {
		height: "80%",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	},
};

const TimerDrawer = (props: {
	opened: boolean;
	onClose: () => void;
	stopTimer: () => void;
	startTimer: (duration: number) => void;
}) => {
	forceUpdateEverySecond();
	const [currentTimer, setCurrentTimer] = useTimerAtom();

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
								const intInput = Number.parseInt(input);
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

const ReorderDrawer = (props: { opened: boolean; onClose: () => void }) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [exerciseElements, exerciseElementsHandlers] = useListState(
		currentWorkout?.exercises || [],
	);

	useDidUpdate(() => {
		const oldOrder = currentWorkout?.exercises.map((e) => e.exerciseId);
		const newOrder = exerciseElements.map((e) => e.exerciseId);
		if (!isEqual(oldOrder, newOrder)) {
			setCurrentWorkout(
				// biome-ignore lint/suspicious/noExplicitAny: weird errors otherwise
				produce(currentWorkout, (draft: any) => {
					draft.exercises = exerciseElements.map((de) =>
						// biome-ignore lint/suspicious/noExplicitAny: weird errors otherwise
						draft.exercises.find((e: any) => e.exerciseId === de.exerciseId),
					);
				}),
			);
			props.onClose();
		}
	}, [exerciseElements]);

	const getProgressOfExercise = (cw: InProgressWorkout, index: number) => {
		const isCompleted = cw.exercises[index].sets.every((s) => s.confirmedAt);
		return isCompleted
			? ("complete" as const)
			: cw.exercises[index].sets.some((s) => s.confirmedAt)
				? ("in-progress" as const)
				: ("not-started" as const);
	};

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
												<ThemeIcon size="xs" variant="transparent" color="gray">
													{match(getProgressOfExercise(currentWorkout, index))
														.with("complete", () => <IconDropletFilled />)
														.with("in-progress", () => (
															<IconDropletHalf2Filled />
														))
														.with("not-started", () => <IconDroplet />)
														.exhaustive()}
												</ThemeIcon>
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

const NoteInput = (props: {
	exerciseIdx: number;
	noteIdx: number;
	note: string;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [value, setValue] = useDebouncedState(props.note, 500);

	useDidUpdate(() => {
		if (currentWorkout)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					draft.exercises[props.exerciseIdx].notes[props.noteIdx] = value;
				}),
			);
	}, [value]);

	return (
		<Flex align="center" gap="xs">
			<Textarea
				style={{ flexGrow: 1 }}
				placeholder="Add a note"
				size="xs"
				minRows={1}
				maxRows={4}
				autosize
				defaultValue={props.note}
				onChange={(e) => setValue(e.currentTarget.value)}
			/>
			<ActionIcon
				color="red"
				onClick={async () => {
					const yes = await confirmWrapper({
						confirmation:
							"This note will be deleted. Are you sure you want to continue?",
					});
					if (yes && currentWorkout)
						setCurrentWorkout(
							produce(currentWorkout, (draft) => {
								draft.exercises[props.exerciseIdx].notes.splice(
									props.noteIdx,
									1,
								);
							}),
						);
				}}
			>
				<IconTrash size={20} />
			</ActionIcon>
		</Flex>
	);
};
