// biome-ignore lint/style/useNodejsImportProtocol: this is a dependency
import { Buffer } from "buffer";
import "@mantine/carousel/styles.css";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { Carousel } from "@mantine/carousel";
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
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Textarea,
	ThemeIcon,
	Transition,
	UnstyledButton,
	rem,
	useMantineTheme,
} from "@mantine/core";
import {
	useDebouncedState,
	useDidUpdate,
	useDisclosure,
	useListState,
	useToggle,
} from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
	CreateOrUpdateUserWorkoutDocument,
	CreateOrUpdateUserWorkoutTemplateDocument,
	type ExerciseDetailsQuery,
	ExerciseLot,
	SetLot,
	type UserExerciseDetailsQuery,
	UserUnitSystem,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	isEqual,
	isNumber,
	isString,
	snakeCase,
	sortBy,
	startCase,
	sum,
} from "@ryot/ts-utils";
import {
	IconCamera,
	IconCameraRotate,
	IconCheck,
	IconChevronUp,
	IconClipboard,
	IconClock,
	IconDotsVertical,
	IconDroplet,
	IconDropletFilled,
	IconDropletHalf2Filled,
	IconInfoCircle,
	IconLayersIntersect,
	IconPhoto,
	IconReorder,
	IconReplace,
	IconTrash,
	IconZzz,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Howl } from "howler";
import { produce } from "immer";
import { RESET } from "jotai/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import { $path } from "remix-routes";
import { ClientOnly } from "remix-utils/client-only";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useInterval, useOnClickOutside } from "usehooks-ts";
import { v4 as randomUUID } from "uuid";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import {
	DisplaySetStatistics,
	ExerciseHistory,
	displayWeightWithUnit,
} from "~/components/fitness";
import {
	FitnessAction,
	FitnessEntity,
	PRO_REQUIRED_MESSAGE,
	clientGqlService,
	dayjsLib,
	getExerciseDetailsPath,
	getSetColor,
	getSurroundingElements,
	postMessageToServiceWorker,
	queryClient,
	queryFactory,
	sendNotificationToServiceWorker,
} from "~/lib/generals";
import {
	forceUpdateEverySecond,
	useApplicationEvents,
	useCoreDetails,
	useGetMantineColors,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/hooks";
import {
	type CurrentWorkoutTimer,
	type InProgressWorkout,
	type Superset,
	convertHistorySetToCurrentSet,
	currentWorkoutToCreateWorkoutInput,
	getExerciseDetailsQuery,
	getRestTimerForSet,
	getUserExerciseDetailsQuery,
	getWorkoutDetails,
	useCurrentWorkout,
	useGetExerciseAtIndex,
	useGetSetAtIndex,
	useMeasurementsDrawerOpen,
	useTimerAtom,
} from "~/lib/state/fitness";

export const loader = async ({ params }: LoaderFunctionArgs) => {
	const { action } = zx.parseParams(params, {
		action: z.nativeEnum(FitnessAction),
	});
	return {
		action,
		isUpdatingWorkout: action === FitnessAction.UpdateWorkout,
		isCreatingTemplate: action === FitnessAction.CreateTemplate,
	};
};

export const meta = ({ data }: MetaArgs<typeof loader>) => {
	return [{ title: `${changeCase(data?.action || "")} | Ryot` }];
};

const deleteUploadedAsset = (key: string) => {
	const formData = new FormData();
	formData.append("key", key);
	fetch($path("/actions", { intent: "deleteS3Asset" }), {
		method: "POST",
		body: formData,
	});
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const events = useApplicationEvents();
	const [parent] = useAutoAnimate();
	const navigate = useNavigate();
	const [isSaveBtnLoading, setIsSaveBtnLoading] = useState(false);
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const playCompleteTimerSound = () => {
		const sound = new Howl({ src: ["/timer-completed.mp3"] });
		if (!userPreferences.fitness.logging.muteSounds) sound.play();
		if (document.visibilityState === "visible") return;
		sendNotificationToServiceWorker(
			"Timer completed",
			"Let's get this done!",
			"timer-completed",
			{ event: "open-link", link: window.location.href },
		);
	};
	useInterval(() => {
		if (
			loaderData.action === FitnessAction.LogWorkout &&
			navigator.serviceWorker.controller &&
			document.visibilityState === "visible"
		)
			postMessageToServiceWorker({
				event: "remove-timer-completed-notification",
			});
	}, 5000);
	const [
		timerDrawerOpened,
		{
			close: timerDrawerClose,
			toggle: timerDrawerToggle,
			open: timerDrawerOpen,
		},
	] = useDisclosure(false);
	const [supersetWithExerciseIdentifier, setSupersetModalOpened] = useState<
		string | null
	>(null);
	const [
		reorderDrawerOpened,
		{ close: reorderDrawerClose, toggle: reorderDrawerToggle },
	] = useDisclosure(false);
	const [_, setMeasurementsDrawerOpen] = useMeasurementsDrawerOpen();
	const [currentTimer, setCurrentTimer] = useTimerAtom();

	useInterval(() => {
		const timeRemaining = dayjsLib(currentTimer?.endAt).diff(
			dayjsLib(),
			"second",
		);
		if (timeRemaining && timeRemaining <= 3) {
			if (navigator.vibrate) navigator.vibrate(200);
			if (timeRemaining <= 1) {
				playCompleteTimerSound();
				stopTimer();
				setTimeout(() => timerDrawerClose(), 500);
			}
		}
	}, 1000);

	const startTimer = (
		duration: number,
		triggeredBy?: { exerciseIdentifier: string; setIdx: number },
	) => {
		setCurrentTimer({
			triggeredBy,
			totalTime: duration,
			endAt: dayjsLib().add(duration, "second").toISOString(),
		});
	};

	const stopTimer = () => {
		const triggeredBy = currentTimer?.triggeredBy;
		if (currentWorkout && triggeredBy) {
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					const exercise = draft.exercises.find(
						(e) => e.identifier === triggeredBy.exerciseIdentifier,
					);
					const restTimer = exercise?.sets[triggeredBy.setIdx].restTimer;
					if (exercise && restTimer) restTimer.hasElapsed = true;
				}),
			);
		}
		setCurrentTimer(RESET);
	};

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
							<DisplaySupersetModal
								supersetWith={supersetWithExerciseIdentifier}
								onClose={() => setSupersetModalOpened(null)}
							/>
							<Stack ref={parent}>
								<NameAndCommentInputs />
								<Group>
									<WorkoutDurationTimer />
									<StatDisplay
										name="Exercises"
										value={
											loaderData.isCreatingTemplate
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
														loaderData.isCreatingTemplate || s.confirmedAt
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
													loaderData.isCreatingTemplate || s.confirmedAt
														? 1
														: 0,
												),
										).toString()}
									/>
								</Group>
								<Divider />
								<SimpleGrid
									cols={
										2 +
										(loaderData.isCreatingTemplate ||
										loaderData.isUpdatingWorkout
											? -1
											: 0) +
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
										style={
											loaderData.isCreatingTemplate ||
											loaderData.isUpdatingWorkout
												? { display: "none" }
												: undefined
										}
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
												radius="md"
												color="green"
												variant="subtle"
												size="compact-sm"
												loading={isSaveBtnLoading}
												onClick={async () => {
													if (!currentWorkout.name) {
														notifications.show({
															color: "red",
															message: `Please give a name to the ${
																loaderData.isCreatingTemplate
																	? "template"
																	: "workout"
															}`,
														});
														return;
													}
													const yes = await confirmWrapper({
														confirmation: loaderData.isCreatingTemplate
															? "Only sets that have data will added. Are you sure you want to save this template?"
															: "Only sets marked as confirmed will be recorded. Are you sure you want to finish this workout?",
													});
													if (yes) {
														setIsSaveBtnLoading(true);
														await new Promise((r) => setTimeout(r, 1000));
														const input = currentWorkoutToCreateWorkoutInput(
															currentWorkout,
															loaderData.isCreatingTemplate,
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
														try {
															const [entityId, fitnessEntity] = await match(
																loaderData.isCreatingTemplate,
															)
																.with(true, () =>
																	clientGqlService
																		.request(
																			CreateOrUpdateUserWorkoutTemplateDocument,
																			input,
																		)
																		.then((c) => [
																			c.createOrUpdateUserWorkoutTemplate,
																			FitnessEntity.Templates,
																		]),
																)
																.with(false, () =>
																	clientGqlService
																		.request(
																			CreateOrUpdateUserWorkoutDocument,
																			input,
																		)
																		.then((c) => [
																			c.createOrUpdateUserWorkout,
																			FitnessEntity.Workouts,
																		]),
																)
																.exhaustive();
															if (
																loaderData.action === FitnessAction.LogWorkout
															)
																events.createWorkout();
															setCurrentWorkout(RESET);
															navigate(
																$path("/fitness/:entity/:id", {
																	id: entityId,
																	entity: fitnessEntity,
																}),
															);
														} catch (e) {
															notifications.show({
																color: "red",
																message: `Error while saving workout: ${JSON.stringify(e)}`,
															});
															setIsSaveBtnLoading(false);
														}
													}
												}}
											>
												{loaderData.isCreatingTemplate ||
												loaderData.isUpdatingWorkout
													? "Save"
													: "Finish"}
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
												confirmation: `Are you sure you want to cancel this ${
													loaderData.isCreatingTemplate ? "template" : "workout"
												}?`,
											});
											if (yes) {
												for (const e of currentWorkout.exercises) {
													const assets = [...e.images, ...e.videos];
													for (const asset of assets)
														deleteUploadedAsset(asset.key);
												}
												navigate($path("/"), { replace: true });
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
										exerciseIdx={idx}
										key={ex.identifier}
										stopTimer={stopTimer}
										startTimer={startTimer}
										openTimerDrawer={timerDrawerOpen}
										reorderDrawerToggle={reorderDrawerToggle}
										openSupersetModal={(s) => setSupersetModalOpened(s)}
									/>
								))}
								<Group justify="center">
									{userPreferences.featuresEnabled.fitness.measurements ? (
										<Button
											color="teal"
											variant="subtle"
											onClick={() => setMeasurementsDrawerOpen(true)}
											style={
												loaderData.isCreatingTemplate
													? { display: "none" }
													: undefined
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
				<Text>
					Loading {loaderData.isCreatingTemplate ? "template" : "workout"}...
				</Text>
			)}
		</Container>
	);
}

const NameAndCommentInputs = () => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);

	const [name, setName] = useDebouncedState(currentWorkout.name, 500);
	const [comment, setComment] = useDebouncedState(currentWorkout.comment, 500);

	useDidUpdate(() => {
		if (name)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					draft.name = name;
				}),
			);
	}, [name]);

	useDidUpdate(() => {
		if (comment)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					draft.comment = comment;
				}),
			);
	}, [comment]);

	return (
		<>
			<TextInput
				size="sm"
				required
				label="Name"
				defaultValue={name}
				placeholder="A name for your workout"
				onChange={(e) => setName(e.currentTarget.value)}
			/>
			<Textarea
				size="sm"
				minRows={2}
				label="Comment"
				defaultValue={comment}
				placeholder="Your thoughts about this workout"
				onChange={(e) => setComment(e.currentTarget.value)}
			/>
		</>
	);
};

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

const formatTimerDuration = (duration: number) =>
	dayjsLib.duration(duration).format("mm:ss");

const offsetDate = (startTime?: string) => {
	const now = dayjsLib();
	return now.diff(dayjsLib(startTime), "seconds");
};

const RestTimer = () => {
	forceUpdateEverySecond();
	const [currentTimer] = useTimerAtom();

	return currentTimer
		? formatTimerDuration(dayjsLib(currentTimer.endAt).diff(dayjsLib()))
		: "Timer";
};

const WorkoutDurationTimer = () => {
	const { isCreatingTemplate, isUpdatingWorkout } =
		useLoaderData<typeof loader>();
	const [currentWorkout] = useCurrentWorkout();
	const seconds = offsetDate(currentWorkout?.startTime);

	forceUpdateEverySecond();

	let format = "mm:ss";
	if (seconds > 3600) format = `H:${format}`;

	return (
		<StatDisplay
			name="Duration"
			value={dayjsLib.duration(seconds * 1000).format(format)}
			isHidden={isCreatingTemplate || isUpdatingWorkout}
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

const ImageDisplay = (props: { imageSrc: string; removeImage: () => void }) => {
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

const DisplaySupersetModal = ({
	onClose,
	supersetWith,
}: { onClose: () => void; supersetWith: string | null }) => {
	const [cw] = useCurrentWorkout();

	const exerciseAlreadyInSuperset = useMemo(() => {
		if (cw && supersetWith) {
			const index = cw?.supersets.findIndex((s) =>
				s.exercises.includes(supersetWith),
			);
			if (index !== -1) return [index, cw.supersets[index]] as const;
		}
		return undefined;
	}, [cw, supersetWith]);

	return (
		<Modal
			onClose={onClose}
			withCloseButton={false}
			opened={isString(supersetWith)}
		>
			{supersetWith ? (
				exerciseAlreadyInSuperset ? (
					<EditSupersetModal
						onClose={onClose}
						supersetWith={supersetWith}
						superset={exerciseAlreadyInSuperset}
					/>
				) : (
					<CreateSupersetModal onClose={onClose} supersetWith={supersetWith} />
				)
			) : null}
		</Modal>
	);
};

const CreateSupersetModal = (props: {
	onClose: () => void;
	supersetWith: string;
}) => {
	const [cw, setCurrentWorkout] = useCurrentWorkout();
	const [exercises, setExercisesHandle] = useListState<string>([
		props.supersetWith,
	]);
	const colors = useGetMantineColors();
	const [allowedColors, setAllowedColors] = useState<string[]>([]);
	const [selectedColor, setSelectedColor] = useState<string>("");

	useEffect(() => {
		if (cw) {
			const newColors = colors
				.filter((c) => !["dark", "gray"].includes(c))
				.filter((c) => !cw.supersets.map((s) => s.color).includes(c));
			setAllowedColors(newColors);
			setSelectedColor(newColors[0]);
		}
	}, [cw]);

	if (!cw) return null;

	return (
		<Stack gap="lg">
			<Group wrap="nowrap">
				<Text>Select color</Text>
				<Select
					size="xs"
					value={selectedColor}
					leftSectionWidth={rem(40)}
					onChange={(v) => setSelectedColor(v ?? "")}
					data={allowedColors.map((c) => ({
						value: c,
						label: changeCase(c),
					}))}
				/>
			</Group>
			<Stack gap="xs">
				{cw.exercises.map((ex) => {
					const index = exercises.findIndex((e) => e === ex.identifier);
					return (
						<Button
							size="xs"
							fullWidth
							key={ex.identifier}
							color={selectedColor}
							variant={index !== -1 ? "light" : "outline"}
							disabled={cw.supersets
								.flatMap((s) => s.exercises)
								.includes(ex.identifier)}
							onClick={() => {
								if (index !== -1) setExercisesHandle.remove(index);
								else setExercisesHandle.append(ex.identifier);
							}}
						>
							{ex.exerciseId}
						</Button>
					);
				})}
			</Stack>
			<Button
				disabled={exercises.length <= 1}
				onClick={() => {
					setCurrentWorkout(
						produce(cw, (draft) => {
							draft.supersets.push({
								exercises,
								color: selectedColor,
								identifier: randomUUID(),
							});
						}),
					);
					props.onClose();
				}}
			>
				Create superset
			</Button>
		</Stack>
	);
};

const EditSupersetModal = (props: {
	onClose: () => void;
	supersetWith: string;
	superset: readonly [number, Superset];
}) => {
	const [cw, setCurrentWorkout] = useCurrentWorkout();
	const [exercises, setExercisesHandle] = useListState<string>(
		props.superset[1].exercises,
	);

	if (!cw) return null;

	return (
		<Stack gap="lg">
			<Text>Editing {props.superset[1].color} superset:</Text>
			<Stack gap="xs">
				{cw.exercises.map((ex) => {
					const index = exercises.findIndex((e) => e === ex.identifier);
					return (
						<Button
							size="xs"
							fullWidth
							key={ex.identifier}
							color={props.superset[1].color}
							variant={index !== -1 ? "light" : "outline"}
							disabled={cw.supersets
								.filter((s) => s.identifier !== props.superset[1].identifier)
								.flatMap((s) => s.exercises)
								.includes(ex.identifier)}
							onClick={() => {
								if (index !== -1) setExercisesHandle.remove(index);
								else setExercisesHandle.append(ex.identifier);
							}}
						>
							{ex.exerciseId}
						</Button>
					);
				})}
			</Stack>
			<Group wrap="nowrap">
				<Button
					color="red"
					flex="none"
					onClick={async () => {
						const yes = await confirmWrapper({
							confirmation: "Are you sure you want to delete this superset?",
						});
						if (yes) {
							setCurrentWorkout(
								produce(cw, (draft) => {
									draft.supersets.splice(props.superset[0], 1);
								}),
							);
							props.onClose();
						}
					}}
				>
					Delete superset
				</Button>
				<Button
					fullWidth
					disabled={
						exercises.length <= 1 ||
						props.superset[1].exercises.length === exercises.length
					}
					onClick={() => {
						setCurrentWorkout(
							produce(cw, (draft) => {
								draft.supersets[props.superset[0]].exercises = exercises;
							}),
						);
						props.onClose();
					}}
				>
					Add to superset
				</Button>
			</Group>
		</Stack>
	);
};

type FuncStartTimer = (
	duration: number,
	triggeredBy: { exerciseIdentifier: string; setIdx: number },
) => void;

const focusOnExercise = (idx: number) => {
	setTimeout(() => {
		const exercise = document.getElementById(idx.toString());
		exercise?.scrollIntoView({ behavior: "smooth" });
	}, 800);
};

const exerciseHasDetailsToShow = (
	details?: ExerciseDetailsQuery["exerciseDetails"],
	userDetails?: UserExerciseDetailsQuery["userExerciseDetails"],
) =>
	(details?.attributes.images.length || 0) > 0 ||
	(userDetails?.history?.length || 0) > 0;

const ExerciseDisplay = (props: {
	exerciseIdx: number;
	stopTimer: () => void;
	startTimer: FuncStartTimer;
	openTimerDrawer: () => void;
	reorderDrawerToggle: () => void;
	openSupersetModal: (s: string) => void;
}) => {
	const { isCreatingTemplate } = useLoaderData<typeof loader>();
	const theme = useMantineTheme();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const navigate = useNavigate();
	const [parent] = useAutoAnimate();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [currentTimer, _] = useTimerAtom();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const coreDetails = useCoreDetails();
	const fileUploadAllowed = coreDetails.fileStorageEnabled;
	const [detailsParent] = useAutoAnimate();
	const { data: exerciseDetails } = useQuery(
		getExerciseDetailsQuery(exercise.exerciseId),
	);
	const { data: userExerciseDetails } = useQuery(
		getUserExerciseDetailsQuery(exercise.exerciseId),
	);
	const [activeHistoryIdx, setActiveHistoryIdx] = useState(0);

	const playAddSetSound = () => {
		const sound = new Howl({ src: ["/add-set.mp3"] });
		if (!userPreferences.fitness.logging.muteSounds) sound.play();
	};
	const [cameraFacing, toggleCameraFacing] = useToggle([
		"environment",
		"user",
	] as const);
	const webcamRef = useRef<Webcam>(null);
	const [
		assetsModalOpened,
		{ close: assetsModalClose, toggle: assetsModalToggle },
	] = useDisclosure(false);

	const exerciseHistory = userExerciseDetails?.history;
	const [durationCol, distanceCol, weightCol, repsCol] = match(exercise.lot)
		.with(ExerciseLot.DistanceAndDuration, () => [true, true, false, false])
		.with(ExerciseLot.Duration, () => [true, false, false, false])
		.with(ExerciseLot.RepsAndWeight, () => [false, false, true, true])
		.with(ExerciseLot.Reps, () => [false, false, false, true])
		.exhaustive();
	const toBeDisplayedColumns =
		[durationCol, distanceCol, weightCol, repsCol].filter(Boolean).length + 1;

	if (!currentWorkout) return null;

	const exerciseProgress = getProgressOfExercise(
		currentWorkout,
		props.exerciseIdx,
	);
	const partOfSuperset = currentWorkout.supersets.find((s) =>
		s.exercises.includes(exercise.identifier),
	);

	const didExerciseActivateTimer =
		currentTimer?.triggeredBy?.exerciseIdentifier === exercise.identifier;

	const toggleExerciseCollapse = () => {
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				draft.exercises[props.exerciseIdx].isCollapsed = !exercise.isCollapsed;
			}),
		);
	};

	return (
		<>
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
				radius={0}
				style={{
					scrollMargin: "60px",
					borderLeft: partOfSuperset
						? `3px solid ${theme.colors[partOfSuperset.color][6]}`
						: undefined,
				}}
				pl="sm"
				ml={{ base: "-md", md: 0 }}
				id={props.exerciseIdx.toString()}
				pr={{ base: 4, md: "xs", lg: "sm" }}
			>
				<Stack ref={parent}>
					<Menu shadow="md" width={200} position="left-end">
						<Group justify="space-between" pos="relative" wrap="nowrap">
							<Anchor
								fw="bold"
								lineClamp={1}
								component={Link}
								to={getExerciseDetailsPath(exercise.exerciseId)}
							>
								{exercise.exerciseId}
							</Anchor>
							<Group wrap="nowrap" mr={-10}>
								{didExerciseActivateTimer ? (
									<DisplayLastExerciseSetRestTimer />
								) : null}
								<ActionIcon
									variant="transparent"
									style={{
										transition: "rotate 0.3s",
										rotate: exercise.isCollapsed ? "180deg" : undefined,
									}}
									color={match(exerciseProgress)
										.with("complete", () => "green")
										.with("in-progress", () => "blue")
										.otherwise(() => undefined)}
									onClick={() => toggleExerciseCollapse()}
								>
									<IconChevronUp />
								</ActionIcon>
								<Menu.Target>
									<ActionIcon color="blue">
										<IconDotsVertical size={20} />
									</ActionIcon>
								</Menu.Target>
							</Group>
						</Group>
						<Menu.Dropdown>
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
								onClick={() => props.openSupersetModal(exercise.identifier)}
							>
								{partOfSuperset ? "Edit" : "Create"} superset
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
							<Menu.Item
								leftSection={<IconReplace size={14} />}
								onClick={() => {
									if (!coreDetails.isPro) {
										notifications.show({
											message: PRO_REQUIRED_MESSAGE,
											color: "red",
										});
										return;
									}
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.replacingExerciseIdx = props.exerciseIdx;
										}),
									);
									navigate($path("/fitness/exercises/list"));
								}}
							>
								Replace exercise
							</Menu.Item>
							{exerciseHasDetailsToShow(
								exerciseDetails,
								userExerciseDetails,
							) ? (
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
								leftSection={<IconReorder size={14} />}
								onClick={props.reorderDrawerToggle}
							>
								Reorder
							</Menu.Item>
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
												const idx = draft.supersets.findIndex((s) =>
													s.exercises.includes(exercise.identifier),
												);
												if (idx !== -1) {
													if (draft.supersets[idx].exercises.length === 2)
														draft.supersets.splice(idx, 1);
													else
														draft.supersets[idx].exercises = draft.supersets[
															idx
														].exercises.filter(
															(e) => e !== exercise.identifier,
														);
												}
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
					{exercise.isCollapsed ? null : (
						<Stack ref={parent}>
							{exercise.notes.map((note, idx) => (
								<NoteInput
									key={`${exercise.identifier}-${idx}`}
									exerciseIdx={props.exerciseIdx}
									noteIdx={idx}
									note={note}
								/>
							))}
							{exercise.isShowDetailsOpen ? (
								<Box ref={detailsParent} pos="relative">
									{match(exercise.openedDetailsTab)
										.with("images", undefined, () => (
											<ScrollArea type="scroll">
												<Group wrap="nowrap">
													{exerciseDetails?.attributes.images.map((i) => (
														<Image
															key={i}
															radius="md"
															src={i}
															h={200}
															w={350}
														/>
													))}
												</Group>
											</ScrollArea>
										))
										.with("history", () => (
											<Carousel
												align="start"
												slideGap="md"
												withControls={false}
												style={{ userSelect: "none" }}
												onSlideChange={setActiveHistoryIdx}
												slideSize={{ base: "100%", md: "50%" }}
											>
												{exerciseHistory?.map((history, idx) => (
													<Carousel.Slide
														key={`${history.workoutId}-${history.idx}`}
													>
														{getSurroundingElements(
															exerciseHistory,
															activeHistoryIdx,
														).includes(idx) ? (
															<ExerciseHistory
																hideExerciseDetails
																hideExtraDetailsButton
																exerciseIdx={history.idx}
																entityId={history.workoutId}
																entityType={FitnessEntity.Workouts}
																onCopyButtonClick={async () => {
																	if (!coreDetails.isPro) {
																		notifications.show({
																			color: "red",
																			message:
																				"Ryot Pro required to copy sets from other workouts",
																		});
																		return;
																	}
																	const workout = await getWorkoutDetails(
																		history.workoutId,
																	);
																	const yes = await confirmWrapper({
																		confirmation: `Are you sure you want to copy all sets from "${workout.details.name}"?`,
																	});
																	if (yes) {
																		const sets =
																			workout.details.information.exercises[
																				history.idx
																			].sets;
																		const converted = sets.map((set) =>
																			convertHistorySetToCurrentSet(set),
																		);
																		setCurrentWorkout(
																			produce(currentWorkout, (draft) => {
																				draft.exercises[
																					props.exerciseIdx
																				].sets.push(...converted);
																			}),
																		);
																	}
																}}
															/>
														) : null}
													</Carousel.Slide>
												))}
											</Carousel>
										))
										.exhaustive()}
									{(userExerciseDetails?.history?.length || 0) > 0 ? (
										<ActionIcon
											right={10}
											bottom={10}
											variant="filled"
											color="red"
											size="sm"
											pos="absolute"
											p={2}
											onClick={() => {
												if (!coreDetails.isPro) {
													notifications.show({
														color: "red",
														message: PRO_REQUIRED_MESSAGE,
													});
													return;
												}
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														draft.exercises[
															props.exerciseIdx
														].openedDetailsTab =
															exercise.openedDetailsTab === "images"
																? "history"
																: "images";
													}),
												);
											}}
										>
											{match(exercise.openedDetailsTab)
												.with("images", undefined, () => <IconPhoto />)
												.with("history", () => <IconClock />)
												.exhaustive()}
										</ActionIcon>
									) : null}
								</Box>
							) : null}
							<Flex justify="space-between" align="center">
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
									openTimerDrawer={props.openTimerDrawer}
									toBeDisplayedColumns={toBeDisplayedColumns}
								/>
							))}
							<Button
								size="compact-xs"
								variant="transparent"
								onClick={async () => {
									playAddSetSound();
									const setLot = SetLot.Normal;
									const restTimer = await getRestTimerForSet(
										setLot,
										exercise.exerciseId,
										userPreferences.fitness.exercises.setRestTimers,
									);
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											const currentSet =
												draft.exercises[props.exerciseIdx].sets.at(-1);
											draft.exercises[props.exerciseIdx].sets.push({
												lot: setLot,
												confirmedAt: null,
												statistic: currentSet?.statistic ?? {},
												restTimer: restTimer
													? { duration: restTimer }
													: undefined,
											});
										}),
									);
								}}
							>
								Add set
							</Button>
						</Stack>
					)}
				</Stack>
			</Paper>
		</>
	);
};

const DisplayLastExerciseSetRestTimer = () => {
	const [currentTimer] = useTimerAtom();
	forceUpdateEverySecond();

	if (!currentTimer) return null;

	return (
		<RingProgress
			roundCaps
			size={30}
			thickness={2}
			style={{ cursor: "pointer" }}
			sections={[
				{
					value:
						(dayjsLib(currentTimer.endAt).diff(dayjsLib(), "seconds") * 100) /
						currentTimer.totalTime,
					color: "blue",
				},
			]}
			label={
				<Text ta="center" size="xs">
					{Math.ceil(dayjsLib(currentTimer.endAt).diff(dayjsLib()) / 1000)}
				</Text>
			}
		/>
	);
};

const getNextSetInWorkout = (
	currentWorkout: InProgressWorkout,
	currentExerciseIdx: number,
	currentSetIdx: number,
) => {
	const currentExercise = currentWorkout.exercises[currentExerciseIdx];
	const partOfSuperset = currentWorkout.supersets.find((superset) =>
		superset.exercises.includes(currentExercise.identifier),
	);
	const areAllSetsConfirmed = currentExercise.sets.every((s) => s.confirmedAt);
	if (partOfSuperset) {
		const sortedExercises = sortBy(partOfSuperset.exercises, (s) =>
			currentWorkout.exercises.findIndex((e) => e.identifier === s),
		);
		const nextExerciseWithIncompleteSets = currentWorkout.exercises.find(
			(e) =>
				e.identifier !== currentExercise.identifier &&
				sortedExercises.includes(e.identifier) &&
				e.sets.some((s) => !s.confirmedAt),
		);
		if (nextExerciseWithIncompleteSets) {
			const exerciseIdx = currentWorkout.exercises.findIndex(
				(e) => e.identifier === nextExerciseWithIncompleteSets.identifier,
			);
			const setIdx = nextExerciseWithIncompleteSets.sets.findIndex(
				(s) => !s.confirmedAt,
			);
			return { exerciseIdx, setIdx: setIdx, wasLastSet: areAllSetsConfirmed };
		}
	}
	if (areAllSetsConfirmed)
		return {
			exerciseIdx: currentExerciseIdx + 1,
			setIdx: 0,
			wasLastSet: true,
		};
	return {
		exerciseIdx: currentExerciseIdx,
		setIdx: currentSetIdx + 1,
		wasLastSet: false,
	};
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
	openTimerDrawer: () => void;
	toBeDisplayedColumns: number;
}) => {
	const { isCreatingTemplate } = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const [currentTimer, _] = useTimerAtom();
	const [parent] = useAutoAnimate();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	const [isEditingRestTimer, setIsEditingRestTimer] = useState(false);
	const [value, setValue] = useDebouncedState(set?.note || "", 500);
	const { data: exerciseDetails } = useQuery(
		getExerciseDetailsQuery(exercise.exerciseId),
	);
	const { data: userExerciseDetails } = useQuery(
		getUserExerciseDetailsQuery(exercise.exerciseId),
	);

	const playCheckSound = () => {
		const sound = new Howl({ src: ["/check.mp3"] });
		if (!userPreferences.fitness.logging.muteSounds) sound.play();
	};

	useDidUpdate(() => {
		if (currentWorkout && isString(value))
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					draft.exercises[props.exerciseIdx].sets[props.setIdx].note = value;
				}),
			);
	}, [value]);

	if (!currentWorkout || !exercise || !set) return null;

	const didCurrentSetActivateTimer =
		currentTimer?.triggeredBy?.exerciseIdentifier === exercise.identifier &&
		currentTimer?.triggeredBy?.setIdx === props.setIdx;

	const hasRestTimerOfThisSetElapsed = set.restTimer?.hasElapsed;

	return (
		<Paper id={`${props.exerciseIdx}-${props.setIdx}`}>
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
								onClick={async () => {
									const restTime = await getRestTimerForSet(
										lot,
										currentWorkout.exercises[props.exerciseIdx].exerciseId,
										userPreferences.fitness.exercises.setRestTimers,
									);
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											const currentSet =
												draft.exercises[props.exerciseIdx].sets[props.setIdx];
											currentSet.lot = lot;
											if (!hasRestTimerOfThisSetElapsed && restTime)
												currentSet.restTimer = { duration: restTime };
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
							fz="xs"
							leftSection={<IconClipboard size={14} />}
							onClick={() => {
								if (!coreDetails.isPro) {
									notifications.show({
										color: "red",
										message: PRO_REQUIRED_MESSAGE,
									});
									return;
								}
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										const hasNote = !!set.note;
										let currentSetNote =
											draft.exercises[props.exerciseIdx].sets[props.setIdx]
												.note;
										if (!hasNote) currentSetNote = true;
										else currentSetNote = undefined;
										draft.exercises[props.exerciseIdx].sets[props.setIdx].note =
											currentSetNote;
									}),
								);
							}}
						>
							{!set.note ? "Add" : "Remove"} note
						</Menu.Item>
						<Menu.Item
							fz="xs"
							leftSection={<IconZzz size={14} />}
							onClick={() => {
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										const hasRestTimer = !!set.restTimer;
										if (hasRestTimer)
											draft.exercises[props.exerciseIdx].sets[
												props.setIdx
											].restTimer = undefined;
										else
											draft.exercises[props.exerciseIdx].sets[
												props.setIdx
											].restTimer = { duration: 60 };
									}),
								);
							}}
						>
							{!set.restTimer ? "Add" : "Remove"} timer
						</Menu.Item>
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
									if (set.restTimer && newConfirmed)
										props.startTimer(set.restTimer.duration, {
											exerciseIdentifier: exercise.identifier,
											setIdx: props.setIdx,
										});
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											const currentExercise =
												draft.exercises[props.exerciseIdx];
											currentExercise.sets[props.setIdx].confirmedAt =
												newConfirmed ? dayjsLib().toISOString() : null;
											if (newConfirmed) {
												const nextSet = getNextSetInWorkout(
													draft,
													props.exerciseIdx,
													props.setIdx,
												);
												focusOnExercise(nextSet.exerciseIdx);
												if (nextSet.wasLastSet) {
													currentExercise.isCollapsed = true;
													currentExercise.isShowDetailsOpen = false;
													const nextExercise =
														draft.exercises[nextSet.exerciseIdx];
													const nextExerciseHasDetailsToShow =
														nextExercise &&
														exerciseHasDetailsToShow(
															exerciseDetails,
															userExerciseDetails,
														);
													if (nextExerciseHasDetailsToShow) {
														nextExercise.isCollapsed = false;
														if (
															userPreferences.fitness.logging
																.showDetailsWhileEditing
														)
															nextExercise.isShowDetailsOpen = true;
													}
												}
											}
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
			{set.note ? (
				<TextInput
					my={4}
					size="xs"
					defaultValue={isString(set.note) ? set.note : ""}
					onChange={(v) => setValue(v.currentTarget.value)}
				/>
			) : undefined}
			<Box mx="xs" mt="xs" ref={parent}>
				{set.restTimer && !didCurrentSetActivateTimer ? (
					<Divider
						labelPosition="center"
						size={hasRestTimerOfThisSetElapsed ? undefined : "lg"}
						color={hasRestTimerOfThisSetElapsed ? "green" : "blue"}
						opacity={hasRestTimerOfThisSetElapsed ? 0.5 : undefined}
						style={{
							cursor: hasRestTimerOfThisSetElapsed ? undefined : "pointer",
						}}
						onClick={() => {
							if (hasRestTimerOfThisSetElapsed) return;
							setIsEditingRestTimer(true);
						}}
						label={
							isEditingRestTimer ? (
								<EditSetRestTimer
									setIdx={props.setIdx}
									exerciseIdx={props.exerciseIdx}
									defaultDuration={set.restTimer.duration}
									onClickOutside={() => setIsEditingRestTimer(false)}
								/>
							) : (
								<Text
									size={hasRestTimerOfThisSetElapsed ? "xs" : "sm"}
									c={hasRestTimerOfThisSetElapsed ? "green" : "blue"}
									fw={hasRestTimerOfThisSetElapsed ? undefined : "bold"}
								>
									{formatTimerDuration(set.restTimer.duration * 1000)}
								</Text>
							)
						}
					/>
				) : null}
				{didCurrentSetActivateTimer ? (
					<DisplaySetRestTimer
						currentTimer={currentTimer}
						onClick={props.openTimerDrawer}
					/>
				) : null}
			</Box>
		</Paper>
	);
};

const EditSetRestTimer = (props: {
	setIdx: number;
	exerciseIdx: number;
	defaultDuration: number;
	onClickOutside: () => void;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const editRestTimerRef = useRef<HTMLInputElement>(null);

	const [value, setValue] = useDebouncedState(props.defaultDuration, 500);

	useDidUpdate(() => {
		if (currentWorkout && value)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					const exercise = draft.exercises[props.exerciseIdx];
					exercise.sets[props.setIdx].restTimer = { duration: value };
				}),
			);
	}, [value]);

	useEffect(() => {
		editRestTimerRef.current?.select();
	}, [editRestTimerRef]);

	useOnClickOutside(editRestTimerRef, props.onClickOutside);

	if (!currentWorkout) return null;

	return (
		<NumberInput
			size="xs"
			suffix="s"
			w={rem(80)}
			// This will be fixed when https://github.com/mantinedev/mantine/pull/6997 is merged
			ref={editRestTimerRef}
			value={props.defaultDuration}
			onChange={(v) => {
				if (!v) return;
				setValue(Number.parseInt(v.toString()));
			}}
		/>
	);
};

const DisplaySetRestTimer = (props: {
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
				(dayjsLib(props.currentTimer.endAt).diff(dayjsLib(), "seconds") * 100) /
				props.currentTimer.totalTime
			}
		/>
	);
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
							roundCaps
							size={300}
							thickness={8}
							sections={[
								{
									value:
										(dayjsLib(currentTimer.endAt).diff(dayjsLib(), "seconds") *
											100) /
										currentTimer.totalTime,
									color: "orange",
								},
							]}
							label={
								<>
									<Text ta="center" fz={64}>
										{formatTimerDuration(
											dayjsLib(currentTimer.endAt).diff(dayjsLib()),
										)}
									</Text>
									<Text ta="center" c="dimmed" fz="lg" mt="-md">
										{formatTimerDuration(currentTimer.totalTime * 1000)}
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
												draft.endAt = dayjsLib(draft.endAt)
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
									dayjsLib(currentTimer.endAt).diff(dayjsLib(), "seconds") <= 30
								}
							>
								-30 sec
							</Button>
							<Button
								color="orange"
								onClick={() => {
									setCurrentTimer(
										produce(currentTimer, (draft) => {
											if (draft) {
												draft.endAt = dayjsLib(draft.endAt)
													.add(30, "seconds")
													.toISOString();
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

const getProgressOfExercise = (cw: InProgressWorkout, index: number) => {
	const isCompleted = cw.exercises[index].sets.every((s) => s.confirmedAt);
	return isCompleted
		? ("complete" as const)
		: cw.exercises[index].sets.some((s) => s.confirmedAt)
			? ("in-progress" as const)
			: ("not-started" as const);
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

	return currentWorkout ? (
		<Drawer
			onClose={props.onClose}
			opened={props.opened}
			size="sm"
			styles={styles}
		>
			<DragDropContext
				onDragEnd={({ destination, source }) => {
					const reorderedExerciseDestinationIndex = destination?.index || 0;
					exerciseElementsHandlers.reorder({
						from: source.index,
						to: reorderedExerciseDestinationIndex,
					});
					focusOnExercise(reorderedExerciseDestinationIndex);
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
