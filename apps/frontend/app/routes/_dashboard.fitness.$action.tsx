import { useAutoAnimate } from "@formkit/auto-animate/react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { Carousel } from "@mantine/carousel";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Button,
	Collapse,
	Container,
	Divider,
	Drawer,
	FileButton,
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
	Skeleton,
	Stack,
	Table,
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
	type UseListStateHandlers,
	useDebouncedState,
	useDidUpdate,
	useDisclosure,
	useListState,
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
	IconCheck,
	IconChevronUp,
	IconClipboard,
	IconClock,
	IconDeviceWatch,
	IconDeviceWatchCancel,
	IconDeviceWatchPause,
	IconDotsVertical,
	IconDroplet,
	IconDropletFilled,
	IconDropletHalf2Filled,
	IconHeartSpark,
	IconInfoCircle,
	IconLayersIntersect,
	IconLibraryPhoto,
	IconPhoto,
	IconReorder,
	IconReplace,
	IconStopwatch,
	IconTrash,
	IconZzz,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Howl } from "howler";
import { produce } from "immer";
import { RESET } from "jotai/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { $path } from "remix-routes";
import { ClientOnly } from "remix-utils/client-only";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useInterval, useOnClickOutside } from "usehooks-ts";
import { v4 as randomUUID } from "uuid";
import { z } from "zod";
import { zx } from "zodix";
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
	openConfirmationModal,
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
	type CurrentWorkoutStopwatch,
	type CurrentWorkoutTimer,
	type Exercise,
	type InProgressWorkout,
	type Superset,
	convertHistorySetToCurrentSet,
	currentWorkoutToCreateWorkoutInput,
	getExerciseDetailsQuery,
	getRestTimerForSet,
	getUserExerciseDetailsQuery,
	getWorkoutDetails,
	useCurrentWorkout,
	useCurrentWorkoutStopwatchAtom,
	useCurrentWorkoutTimerAtom,
	useGetExerciseAtIndex,
	useGetSetAtIndex,
	useMeasurementsDrawerOpen,
} from "~/lib/state/fitness";

const DEFAULT_SET_TIMEOUT_DELAY = 800;

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

const getNextSetInWorkout = (
	currentSetIdx: number,
	currentExerciseIdx: number,
	currentWorkout: InProgressWorkout,
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
	if (areAllSetsConfirmed) {
		for (
			let i = currentExerciseIdx + 1;
			i < currentWorkout.exercises.length;
			i++
		) {
			const exerciseProgress =
				getProgressOfExercise(currentWorkout, i) !== "complete";
			if (exerciseProgress)
				return {
					setIdx: 0,
					exerciseIdx: i,
					wasLastSet: true,
				};
		}
	}
	const isLastSetOfLastExercise =
		currentExerciseIdx === currentWorkout.exercises.length - 1 &&
		currentSetIdx ===
			currentWorkout.exercises[currentExerciseIdx].sets.length - 1;
	if (isLastSetOfLastExercise) return { wasLastSet: true };
	return {
		wasLastSet: false,
		setIdx: currentSetIdx + 1,
		exerciseIdx: currentExerciseIdx,
	};
};

type ExerciseDetails = ExerciseDetailsQuery["exerciseDetails"];
type UserExerciseDetails = UserExerciseDetailsQuery["userExerciseDetails"];

const usePerformTasksAfterSetConfirmed = () => {
	const userPreferences = useUserPreferences();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();

	const performTask = async (setIdx: number, exerciseIdx: number) => {
		const exerciseId = currentWorkout?.exercises[exerciseIdx].exerciseId;
		if (!exerciseId) return;
		const exerciseDetails = await queryClient.ensureQueryData(
			getExerciseDetailsQuery(exerciseId),
		);
		const userExerciseDetails = await queryClient.ensureQueryData(
			getUserExerciseDetailsQuery(exerciseId),
		);
		let exerciseIdxToFocusOn = undefined;
		setCurrentWorkout((cw) =>
			produce(cw, (draft) => {
				if (!draft) return;
				const currentExercise = draft.exercises[exerciseIdx];
				const nextSet = getNextSetInWorkout(setIdx, exerciseIdx, draft);
				exerciseIdxToFocusOn = nextSet.exerciseIdx;
				if (nextSet.wasLastSet) {
					currentExercise.isCollapsed = true;
					currentExercise.isShowDetailsOpen = false;
					if (isNumber(nextSet.exerciseIdx)) {
						const nextExercise = draft.exercises[nextSet.exerciseIdx];
						const nextExerciseHasDetailsToShow =
							nextExercise &&
							exerciseHasDetailsToShow(exerciseDetails, userExerciseDetails);
						if (nextExerciseHasDetailsToShow) {
							nextExercise.isCollapsed = false;
							if (userPreferences.fitness.logging.showDetailsWhileEditing)
								nextExercise.isShowDetailsOpen = true;
						}
					}
				}
			}),
		);
		if (isNumber(exerciseIdxToFocusOn)) {
			focusOnExercise(exerciseIdxToFocusOn);
		}
	};

	return performTask;
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
	const [
		timerDrawerOpened,
		{
			open: openTimerDrawer,
			close: closeTimerDrawer,
			toggle: toggleTimerDrawer,
		},
	] = useDisclosure(false);
	const [supersetWithExerciseIdentifier, setSupersetModalOpened] = useState<
		string | null
	>(null);
	const [isReorderDrawerOpened, setIsReorderDrawerOpened] = useState<
		string | null
	>();
	const [_, setMeasurementsDrawerOpen] = useMeasurementsDrawerOpen();
	const [currentTimer, setCurrentTimer] = useCurrentWorkoutTimerAtom();
	const [assetsModalOpened, setAssetsModalOpened] = useState<
		string | null | undefined
	>(undefined);
	const promptForRestTimer = userPreferences.fitness.logging.promptForRestTimer;
	const performTasksAfterSetConfirmed = usePerformTasksAfterSetConfirmed();
	const isWorkoutPaused = isString(currentWorkout?.durations.at(-1)?.to);

	const numberOfExercises = currentWorkout?.exercises.length || 0;
	const shouldDisplayWorkoutTimer = Boolean(
		loaderData.action === FitnessAction.LogWorkout,
	);
	const shouldDisplayReorderButton = Boolean(numberOfExercises > 1);
	const shouldDisplayFinishButton = Boolean(
		loaderData.isCreatingTemplate
			? numberOfExercises > 0
			: currentWorkout?.exercises.some(
					(_e, idx) =>
						getProgressOfExercise(currentWorkout, idx) !== "not-started",
				),
	);
	const shouldDisplayCancelButton = true;

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
	useInterval(() => {
		const timeRemaining = dayjsLib(currentTimer?.willEndAt).diff(
			dayjsLib(),
			"second",
		);
		if (!currentTimer?.wasPausedAt && timeRemaining && timeRemaining <= 3) {
			if (navigator.vibrate) navigator.vibrate(200);
			if (timeRemaining <= 1) {
				const triggeredBy = currentTimer?.triggeredBy;
				if (promptForRestTimer && triggeredBy && currentWorkout) {
					const exerciseIdx = currentWorkout?.exercises.findIndex(
						(c) => c.identifier === triggeredBy.exerciseIdentifier,
					);
					if (
						exerciseIdx !== -1 &&
						exerciseIdx !== undefined &&
						userPreferences.fitness.logging.promptForRestTimer
					) {
						performTasksAfterSetConfirmed(triggeredBy.setIdx, exerciseIdx);
					}
				}
				playCompleteTimerSound();
				stopTimer();
				setTimeout(() => closeTimerDrawer(), DEFAULT_SET_TIMEOUT_DELAY);
			}
		}
	}, 1000);

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
	const startTimer = (
		duration: number,
		triggeredBy?: { exerciseIdentifier: string; setIdx: number },
	) => {
		setCurrentTimer({
			triggeredBy,
			totalTime: duration,
			willEndAt: dayjsLib().add(duration, "second").toISOString(),
		});
	};
	const pauseOrResumeTimer = () => {
		if (currentTimer)
			setCurrentTimer(
				produce(currentTimer, (draft) => {
					draft.willEndAt = dayjsLib(draft.willEndAt)
						.add(dayjsLib().diff(draft.wasPausedAt, "second"), "second")
						.toISOString();
					draft.wasPausedAt = draft.wasPausedAt
						? undefined
						: dayjsLib().toISOString();
				}),
			);
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
	const openReorderDrawer = (exerciseIdentifier: string | null) => {
		setIsReorderDrawerOpened(exerciseIdentifier);
		if (!exerciseIdentifier) return;
		setTimeout(() => {
			setIsReorderDrawerOpened((val) => (val === undefined ? undefined : null));
		}, 4000);
	};

	return (
		<Container size="sm">
			{currentWorkout ? (
				<ClientOnly>
					{() => (
						<>
							<UploadAssetsModal
								modalOpenedBy={assetsModalOpened}
								closeModal={() => setAssetsModalOpened(undefined)}
							/>
							<TimerAndStopwatchDrawer
								stopTimer={stopTimer}
								startTimer={startTimer}
								opened={timerDrawerOpened}
								onClose={closeTimerDrawer}
								pauseOrResumeTimer={pauseOrResumeTimer}
							/>
							<ReorderDrawer
								key={currentWorkout.exercises.toString()}
								exerciseToReorder={isReorderDrawerOpened}
								opened={isReorderDrawerOpened !== undefined}
								onClose={() => setIsReorderDrawerOpened(undefined)}
							/>
							<DisplaySupersetModal
								supersetWith={supersetWithExerciseIdentifier}
								onClose={() => setSupersetModalOpened(null)}
							/>
							<Stack ref={parent}>
								<NameAndOtherInputs
									openAssetsModal={() => setAssetsModalOpened(null)}
								/>
								<Group>
									<WorkoutDurationTimer isWorkoutPaused={isWorkoutPaused} />
									<StatDisplay
										name="Exercises"
										value={
											loaderData.isCreatingTemplate
												? numberOfExercises.toString()
												: `${
														currentWorkout.exercises
															.map((e) => e.sets.every((s) => s.confirmedAt))
															.filter(Boolean).length
													}/${numberOfExercises}`
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
										Number(shouldDisplayWorkoutTimer) +
										Number(shouldDisplayReorderButton) +
										Number(shouldDisplayFinishButton) +
										Number(shouldDisplayCancelButton)
									}
								>
									{shouldDisplayWorkoutTimer ? (
										<Button
											radius="md"
											color="orange"
											variant="subtle"
											size="compact-sm"
											onClick={toggleTimerDrawer}
										>
											<RestTimer />
										</Button>
									) : null}
									{shouldDisplayReorderButton ? (
										<Button
											radius="md"
											color="blue"
											variant="subtle"
											size="compact-sm"
											onClick={() => openReorderDrawer(null)}
										>
											Reorder
										</Button>
									) : null}
									{shouldDisplayFinishButton ? (
										<Button
											radius="md"
											color="green"
											variant="subtle"
											size="compact-sm"
											loading={isSaveBtnLoading}
											disabled={isWorkoutPaused}
											onClick={() => {
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
												openConfirmationModal(
													loaderData.isCreatingTemplate
														? "Only sets that have data will added. Are you sure you want to save this template?"
														: "Only sets marked as confirmed will be recorded. Are you sure you want to finish this workout?",
													async () => {
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
													},
												);
											}}
										>
											{loaderData.isCreatingTemplate ||
											loaderData.isUpdatingWorkout
												? "Save"
												: "Finish"}
										</Button>
									) : null}
									{shouldDisplayCancelButton ? (
										<Button
											radius="md"
											color="red"
											variant="subtle"
											size="compact-sm"
											onClick={() => {
												openConfirmationModal(
													`Are you sure you want to cancel this ${
														loaderData.isCreatingTemplate
															? "template"
															: "workout"
													}?`,
													() => {
														for (const e of currentWorkout.exercises) {
															const assets = [...e.images, ...e.videos];
															for (const asset of assets)
																deleteUploadedAsset(asset.key);
														}
														navigate($path("/"), { replace: true });
														setCurrentWorkout(RESET);
													},
												);
											}}
										>
											Cancel
										</Button>
									) : null}
								</SimpleGrid>
								<Divider />
								{currentWorkout.exercises.map((ex, idx) => (
									<ExerciseDisplay
										exerciseIdx={idx}
										key={ex.identifier}
										stopTimer={stopTimer}
										startTimer={startTimer}
										isWorkoutPaused={isWorkoutPaused}
										openTimerDrawer={openTimerDrawer}
										reorderDrawerToggle={openReorderDrawer}
										openSupersetModal={(s) => setSupersetModalOpened(s)}
										setOpenAssetsModal={() =>
											setAssetsModalOpened(ex.identifier)
										}
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
				<Stack>
					<Group wrap="nowrap">
						<Skeleton h={80} w="80%" />
						<Skeleton h={80} w="20%" />
					</Group>
					<Group wrap="nowrap">
						<Skeleton h={80} w="20%" />
						<Skeleton h={80} w="80%" />
					</Group>
				</Stack>
			)}
		</Container>
	);
}

const NameAndOtherInputs = (props: {
	openAssetsModal: () => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);

	const [name, setName] = useDebouncedState(currentWorkout.name, 500);
	const [comment, setComment] = useDebouncedState(currentWorkout.comment, 500);
	const [isCaloriesBurntModalOpen, setIsCaloriesBurntModalOpen] =
		useState(false);
	const [caloriesBurnt, setCaloriesBurnt] = useDebouncedState(
		currentWorkout.caloriesBurnt,
		500,
	);
	const workoutHasImages = currentWorkout.images.length > 0;

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

	useDidUpdate(() => {
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				draft.caloriesBurnt = caloriesBurnt;
			}),
		);
	}, [caloriesBurnt]);

	return (
		<>
			<Modal
				title="Additional details"
				opened={isCaloriesBurntModalOpen}
				onClose={() => setIsCaloriesBurntModalOpen(false)}
			>
				<Stack gap="xs">
					<Textarea
						size="sm"
						minRows={2}
						label="Comments"
						defaultValue={comment}
						placeholder="Your thoughts about this workout"
						onChange={(e) => setComment(e.currentTarget.value)}
					/>
					<NumberInput
						size="sm"
						label="Calories burnt"
						value={currentWorkout.caloriesBurnt}
						onChange={(e) => setCaloriesBurnt(isNumber(e) ? e : undefined)}
					/>
				</Stack>
			</Modal>
			<TextInput
				size="sm"
				defaultValue={name}
				placeholder="A name for your workout"
				styles={{ label: { width: "100%" } }}
				onChange={(e) => setName(e.currentTarget.value)}
				rightSection={
					<ActionIcon
						onClick={props.openAssetsModal}
						variant={workoutHasImages ? "outline" : undefined}
					>
						<IconCamera size={30} />
					</ActionIcon>
				}
				label={
					<Group justify="space-between" mr="xs">
						<Text size="sm">Name</Text>
						{!loaderData.isCreatingTemplate ? (
							<Anchor
								size="xs"
								onClick={() => setIsCaloriesBurntModalOpen(true)}
							>
								Details
							</Anchor>
						) : null}
					</Group>
				}
			/>
		</>
	);
};

const StatDisplay = (props: {
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

const formatTimerDuration = (duration: number) =>
	dayjsLib.duration(duration).format("mm:ss");

const RestTimer = () => {
	const [currentWorkout] = useCurrentWorkout();
	const [currentTimer] = useCurrentWorkoutTimerAtom();
	const [currentStopwatch] = useCurrentWorkoutStopwatchAtom();
	invariant(currentWorkout);

	forceUpdateEverySecond();

	const stopwatchMilliSeconds = getStopwatchMilliSeconds(currentStopwatch);

	return match(currentWorkout.timerDrawerLot)
		.with("timer", () =>
			currentTimer
				? formatTimerDuration(
						dayjsLib(currentTimer.willEndAt).diff(currentTimer.wasPausedAt),
					)
				: "Timer",
		)
		.with("stopwatch", () =>
			currentStopwatch
				? formatTimerDuration(stopwatchMilliSeconds)
				: "Stopwatch",
		)
		.exhaustive();
};

const WorkoutDurationTimer = (props: { isWorkoutPaused: boolean }) => {
	const { isCreatingTemplate, isUpdatingWorkout } =
		useLoaderData<typeof loader>();
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
				size="xs"
				required
				hideControls
				step={props.inputStep}
				onChange={(v) => setValue(v)}
				onFocus={(e) => e.target.select()}
				styles={{
					input: { fontSize: 15, width: rem(72), textAlign: "center" },
				}}
				value={
					isString(set.statistic[props.stat])
						? Number(set.statistic[props.stat])
						: undefined
				}
				decimalScale={
					isNumber(props.inputStep)
						? Math.log10(1 / props.inputStep)
						: undefined
				}
			/>
		</Flex>
	) : null;
};

const ImageDisplay = (props: { imageSrc: string; removeImage: () => void }) => {
	return (
		<Box pos="relative">
			<Avatar src={props.imageSrc} size="lg" />
			<ActionIcon
				top={0}
				size="xs"
				left={-12}
				color="red"
				pos="absolute"
				onClick={() => {
					openConfirmationModal(
						"Are you sure you want to remove this image?",
						() => props.removeImage(),
					);
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
				{cw.exercises.map((ex) => (
					<CreateSupersetExerciseButton
						exercise={ex}
						key={ex.identifier}
						exercises={exercises}
						selectedColor={selectedColor}
						setExercisesHandle={setExercisesHandle}
					/>
				))}
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

const CreateSupersetExerciseButton = (props: {
	exercise: Exercise;
	exercises: string[];
	selectedColor: string;
	setExercisesHandle: UseListStateHandlers<string>;
}) => {
	const [cw] = useCurrentWorkout();
	const index = props.exercises.findIndex(
		(e) => e === props.exercise.identifier,
	);
	invariant(cw);

	const { data: exerciseDetails } = useQuery(
		getExerciseDetailsQuery(props.exercise.exerciseId),
	);

	return (
		<Button
			size="xs"
			fullWidth
			color={props.selectedColor}
			variant={index !== -1 ? "light" : "outline"}
			disabled={cw.supersets
				.flatMap((s) => s.exercises)
				.includes(props.exercise.identifier)}
			onClick={() => {
				if (index !== -1) props.setExercisesHandle.remove(index);
				else props.setExercisesHandle.append(props.exercise.identifier);
			}}
		>
			{exerciseDetails?.name}
		</Button>
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
				{cw.exercises.map((ex) => (
					<EditSupersetExerciseButton
						exercise={ex}
						key={ex.identifier}
						exercises={exercises}
						superset={props.superset[1]}
						setExercisesHandle={setExercisesHandle}
					/>
				))}
			</Stack>
			<Group wrap="nowrap">
				<Button
					color="red"
					flex="none"
					onClick={() => {
						openConfirmationModal(
							"Are you sure you want to delete this superset?",
							() => {
								setCurrentWorkout(
									produce(cw, (draft) => {
										draft.supersets.splice(props.superset[0], 1);
									}),
								);
								props.onClose();
							},
						);
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

const EditSupersetExerciseButton = (props: {
	exercise: Exercise;
	superset: Superset;
	exercises: string[];
	setExercisesHandle: UseListStateHandlers<string>;
}) => {
	const [cw] = useCurrentWorkout();
	const index = props.exercises.findIndex(
		(e) => e === props.exercise.identifier,
	);
	invariant(cw);

	const { data: exerciseDetails } = useQuery(
		getExerciseDetailsQuery(props.exercise.exerciseId),
	);

	return (
		<Button
			size="xs"
			fullWidth
			color={props.superset.color}
			variant={index !== -1 ? "light" : "outline"}
			disabled={cw.supersets
				.filter((s) => s.identifier !== props.superset.identifier)
				.flatMap((s) => s.exercises)
				.includes(props.exercise.identifier)}
			onClick={() => {
				if (index !== -1) props.setExercisesHandle.remove(index);
				else props.setExercisesHandle.append(props.exercise.identifier);
			}}
		>
			{exerciseDetails?.name}
		</Button>
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
	}, DEFAULT_SET_TIMEOUT_DELAY);
};

const exerciseHasDetailsToShow = (
	details?: ExerciseDetails,
	userDetails?: UserExerciseDetails,
) =>
	(details?.attributes.images.length || 0) > 0 ||
	(userDetails?.history?.length || 0) > 0;

const UploadAssetsModal = (props: {
	closeModal: () => void;
	modalOpenedBy: string | null | undefined;
}) => {
	const coreDetails = useCoreDetails();
	const fileUploadAllowed = coreDetails.fileStorageEnabled;
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [isFileUploading, setIsFileUploading] = useState(false);

	if (!currentWorkout) return null;

	const afterFileSelected = async (file: File | null) => {
		if (props.modalOpenedBy === null && !coreDetails.isServerKeyValidated) {
			notifications.show({
				color: "red",
				message: PRO_REQUIRED_MESSAGE,
			});
			return;
		}
		if (!file) return;
		setIsFileUploading(true);
		const imageSrc = URL.createObjectURL(file);
		const toSubmitForm = new FormData();
		toSubmitForm.append("file", file, "image.jpg");
		try {
			const resp = await fetch(
				$path("/actions", { intent: "uploadWorkoutAsset" }),
				{ method: "POST", body: toSubmitForm },
			);
			const data = await resp.json();
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					const media = { imageSrc, key: data.key };
					if (exercise) draft.exercises[exerciseIdx].images.push(media);
					else draft.images.push(media);
				}),
			);
		} catch {
			notifications.show({
				color: "red",
				message: "Error while uploading image",
			});
		} finally {
			setIsFileUploading(false);
		}
	};

	const exerciseIdx = currentWorkout.exercises.findIndex(
		(e) => e.identifier === props.modalOpenedBy,
	);
	const exercise =
		exerciseIdx !== -1 ? currentWorkout.exercises[exerciseIdx] : null;

	const { data: exerciseDetails } = useQuery({
		...getExerciseDetailsQuery(exercise?.exerciseId || ""),
		enabled: exercise !== null,
	});

	return (
		<Modal
			onClose={() => props.closeModal()}
			opened={props.modalOpenedBy !== undefined}
			title={`Images for ${exerciseDetails ? exerciseDetails.name : "the workout"}`}
		>
			<Stack>
				{fileUploadAllowed ? (
					<>
						{isString(props.modalOpenedBy) ? (
							exercise && exercise.images.length > 0 ? (
								<Avatar.Group spacing="xs">
									{exercise.images.map((i, imgIdx) => (
										<ImageDisplay
											key={i.key}
											imageSrc={i.imageSrc}
											removeImage={() => {
												deleteUploadedAsset(i.key);
												setCurrentWorkout(
													produce(currentWorkout, (draft) => {
														const images = draft.exercises[exerciseIdx].images;
														images.splice(imgIdx, 1);
														draft.exercises[exerciseIdx].images = images;
													}),
												);
											}}
										/>
									))}
								</Avatar.Group>
							) : null
						) : currentWorkout.images.length > 0 ? (
							<Avatar.Group spacing="xs">
								{currentWorkout.images.map((i, imgIdx) => (
									<ImageDisplay
										key={i.key}
										imageSrc={i.imageSrc}
										removeImage={() => {
											deleteUploadedAsset(i.key);
											setCurrentWorkout(
												produce(currentWorkout, (draft) => {
													const images = draft.images;
													images.splice(imgIdx, 1);
													draft.images = images;
												}),
											);
										}}
									/>
								))}
							</Avatar.Group>
						) : null}
						<Group justify="space-between">
							<FileButton accept="image/*" onChange={afterFileSelected}>
								{(props) => (
									<Button
										{...props}
										flex={1}
										color="cyan"
										variant="outline"
										loading={isFileUploading}
										leftSection={<IconLibraryPhoto />}
									>
										Select picture
									</Button>
								)}
							</FileButton>
							<FileButton
								accept="image/*"
								capture="environment"
								onChange={afterFileSelected}
							>
								{(props) => (
									<Button
										{...props}
										flex={1}
										color="cyan"
										variant="outline"
										loading={isFileUploading}
										leftSection={<IconCamera />}
									>
										Take picture
									</Button>
								)}
							</FileButton>
						</Group>
					</>
				) : (
					<Text c="red" size="sm">
						Please set the S3 variables required to enable file uploading
					</Text>
				)}
			</Stack>
		</Modal>
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

const ExerciseDisplay = (props: {
	exerciseIdx: number;
	stopTimer: () => void;
	isWorkoutPaused: boolean;
	startTimer: FuncStartTimer;
	openTimerDrawer: () => void;
	openSupersetModal: (s: string) => void;
	setOpenAssetsModal: (identifier: string) => void;
	reorderDrawerToggle: (exerciseIdentifier: string | null) => void;
}) => {
	const { isCreatingTemplate } = useLoaderData<typeof loader>();
	const theme = useMantineTheme();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const navigate = useNavigate();
	const [parent] = useAutoAnimate();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [currentTimer, _] = useCurrentWorkoutTimerAtom();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const coreDetails = useCoreDetails();
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
			<Paper
				pl="sm"
				radius={0}
				ml={{ base: "-md", md: 0 }}
				id={props.exerciseIdx.toString()}
				pr={{ base: 4, md: "xs", lg: "sm" }}
				style={{
					scrollMargin: exercise.scrollMarginRemoved ? "10px" : "60px",
					borderLeft: partOfSuperset
						? `3px solid ${theme.colors[partOfSuperset.color][6]}`
						: undefined,
				}}
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
								{exerciseDetails?.name}
							</Anchor>
							<Group wrap="nowrap" mr={-10}>
								{didExerciseActivateTimer ? (
									<DisplayExerciseSetRestTimer
										openTimerDrawer={props.openTimerDrawer}
									/>
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
								style={isCreatingTemplate ? { display: "none" } : undefined}
								onClick={() => props.setOpenAssetsModal(exercise.identifier)}
								rightSection={
									exercise.images.length > 0 ? exercise.images.length : null
								}
							>
								Images
							</Menu.Item>
							<Menu.Item
								leftSection={<IconReplace size={14} />}
								onClick={() => {
									if (!coreDetails.isServerKeyValidated) {
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
								onClick={() => props.reorderDrawerToggle(exercise.identifier)}
							>
								Reorder
							</Menu.Item>
							<Menu.Item
								color="red"
								leftSection={<IconTrash size={14} />}
								onClick={() => {
									openConfirmationModal(
										`This removes '${exerciseDetails?.name}' and all its sets from your workout. You can not undo this action. Are you sure you want to continue?`,
										() => {
											const assets = [...exercise.images, ...exercise.videos];
											for (const asset of assets)
												deleteUploadedAsset(asset.key);
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
										},
									);
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
									note={note}
									noteIdx={idx}
									exerciseIdx={props.exerciseIdx}
									key={`${exercise.identifier}-${idx}`}
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
															src={i}
															h={200}
															w={350}
															radius="md"
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
																	if (!coreDetails.isServerKeyValidated) {
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
																	openConfirmationModal(
																		`Are you sure you want to copy all sets from "${workout.details.name}"?`,
																		() => {
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
																		},
																	);
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
											p={2}
											size="sm"
											right={10}
											bottom={10}
											color="red"
											pos="absolute"
											variant="filled"
											onClick={() => {
												if (!coreDetails.isServerKeyValidated) {
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
									ta="center"
									w={`${(isCreatingTemplate ? 95 : 85) / toBeDisplayedColumns}%`}
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
									isWorkoutPaused={props.isWorkoutPaused}
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

const DisplayExerciseSetRestTimer = (props: {
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

const SetDisplay = (props: {
	setIdx: number;
	repsCol: boolean;
	weightCol: boolean;
	exerciseIdx: number;
	durationCol: boolean;
	distanceCol: boolean;
	stopTimer: () => void;
	isWorkoutPaused: boolean;
	startTimer: FuncStartTimer;
	openTimerDrawer: () => void;
	toBeDisplayedColumns: number;
}) => {
	const { isCreatingTemplate } = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const [currentTimer, _] = useCurrentWorkoutTimerAtom();
	const [parent] = useAutoAnimate();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	const [isEditingRestTimer, setIsEditingRestTimer] = useState(false);
	const [isRpeModalOpen, setIsRpeModalOpen] = useState(false);
	const [isRpeDetailsOpen, setIsRpeDetailsOpen] = useState(false);
	const [value, setValue] = useDebouncedState(set?.note || "", 500);
	const performTasksAfterSetConfirmed = usePerformTasksAfterSetConfirmed();

	const playCheckSound = () => {
		const sound = new Howl({ src: ["/check.mp3"] });
		if (!userPreferences.fitness.logging.muteSounds) sound.play();
	};

	const closeRpeModal = () => setIsRpeModalOpen(false);

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
	const promptForRestTimer = userPreferences.fitness.logging.promptForRestTimer;

	return (
		<>
			<Modal
				opened={isRpeModalOpen}
				withCloseButton={false}
				onClose={closeRpeModal}
				title={
					<Group justify="space-between" gap="xl">
						<Text>Rate of Perceived Exertion</Text>
						<Button
							variant="outline"
							size="compact-xs"
							onClick={() => setIsRpeDetailsOpen(!isRpeDetailsOpen)}
						>
							{isRpeDetailsOpen ? "Hide" : "Show"} instructions
						</Button>
					</Group>
				}
			>
				<Stack>
					<Group>
						<NumberInput
							min={0}
							max={10}
							flex={1}
							value={set.rpe ?? undefined}
							onChange={(v) => {
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										const value = isNumber(v) ? v : null;
										const currentSet =
											draft.exercises[props.exerciseIdx].sets[props.setIdx];
										currentSet.rpe = value;
									}),
								);
							}}
						/>
					</Group>
					<Button fullWidth variant="outline" onClick={closeRpeModal}>
						Done
					</Button>
					<Collapse in={isRpeDetailsOpen}>
						<Stack gap="xs">
							<Text size="xs">
								Your rate of perceived exertion (RPE) refers to how hard you
								think you're pushing yourself during exercise. It's subjective,
								which means that you decide how hard you feel you're working
								during physical activity.
								<Anchor
									ml={2}
									size="xs"
									target="_blank"
									href="https://my.clevelandclinic.org/health/articles/17450-rated-perceived-exertion-rpe-scale"
								>
									Source.
								</Anchor>
							</Text>
							<Table
								p={0}
								fz="xs"
								withRowBorders
								withTableBorder
								withColumnBorders
								data={{
									head: ["Rating", "Perceived Exertion Level"],
									body: [
										["0", "No exertion (at rest)"],
										["1", "Very light"],
										["2 to 3", "Light"],
										["4 to 5", "Moderate (somewhat hard)"],
										["6 to 7", "High (vigorous)"],
										["8 to 9", "Very hard"],
										["10", "Maximum effort (highest possible)"],
									],
								}}
							/>
						</Stack>
					</Collapse>
				</Stack>
			</Modal>
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
						<Menu.Dropdown px={0}>
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
									if (!coreDetails.isServerKeyValidated) {
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
											draft.exercises[props.exerciseIdx].sets[
												props.setIdx
											].note = currentSetNote;
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
								fz="xs"
								leftSection={<IconHeartSpark size={14} />}
								onClick={() => setIsRpeModalOpen(true)}
							>
								Adjust RPE
							</Menu.Item>
							<Menu.Item
								color="red"
								fz="xs"
								leftSection={<IconTrash size={14} />}
								onClick={() => {
									openConfirmationModal(
										"Are you sure you want to delete this set?",
										() => {
											setCurrentWorkout(
												produce(currentWorkout, (draft) => {
													draft.exercises[props.exerciseIdx].sets.splice(
														props.setIdx,
														1,
													);
												}),
											);
										},
									);
								}}
							>
								Delete set
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
							{(style) =>
								set.displayRestTimeTrigger ? (
									<ActionIcon
										color="blue"
										style={style}
										variant="outline"
										onClick={() => {
											invariant(set.restTimer);
											props.startTimer(set.restTimer.duration, {
												setIdx: props.setIdx,
												exerciseIdentifier: exercise.identifier,
											});
											setCurrentWorkout(
												produce(currentWorkout, (draft) => {
													const currentExercise =
														draft.exercises[props.exerciseIdx];
													const currentSet = currentExercise.sets[props.setIdx];
													currentSet.displayRestTimeTrigger = false;
													currentSet.restTimerStartedAt =
														dayjsLib().toISOString();
												}),
											);
										}}
									>
										<IconStopwatch />
									</ActionIcon>
								) : (
									<ActionIcon
										color="green"
										style={style}
										variant={set.confirmedAt ? "filled" : "outline"}
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
												.with(ExerciseLot.Reps, () =>
													isString(set.statistic.reps),
												)
												.with(
													ExerciseLot.RepsAndWeight,
													() =>
														isString(set.statistic.reps) &&
														isString(set.statistic.weight),
												)
												.exhaustive()
										}
										onClick={async () => {
											playCheckSound();
											const newConfirmed = !set.confirmedAt;
											if (
												!newConfirmed &&
												currentTimer?.triggeredBy?.exerciseIdentifier ===
													exercise.identifier &&
												currentTimer?.triggeredBy?.setIdx === props.setIdx
											)
												props.stopTimer();
											if (set.restTimer && newConfirmed && !promptForRestTimer)
												props.startTimer(set.restTimer.duration, {
													setIdx: props.setIdx,
													exerciseIdentifier: exercise.identifier,
												});
											setCurrentWorkout(
												produce(currentWorkout, (draft) => {
													if (props.isWorkoutPaused)
														draft.durations.push({
															from: dayjsLib().toISOString(),
														});
													const currentExercise =
														draft.exercises[props.exerciseIdx];
													const currentSet = currentExercise.sets[props.setIdx];
													currentSet.confirmedAt = newConfirmed
														? currentWorkout.currentAction ===
															FitnessAction.UpdateWorkout
															? true
															: dayjsLib().toISOString()
														: null;
													currentExercise.scrollMarginRemoved = true;
													if (
														newConfirmed &&
														promptForRestTimer &&
														set.restTimer
													)
														currentSet.displayRestTimeTrigger = true;
												}),
											);
											if (newConfirmed && !promptForRestTimer) {
												await performTasksAfterSetConfirmed(
													props.setIdx,
													props.exerciseIdx,
												);
											}
										}}
									>
										<IconCheck />
									</ActionIcon>
								)
							}
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
		</>
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
				(dayjsLib(props.currentTimer.willEndAt).diff(dayjsLib(), "seconds") *
					100) /
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

const restTimerOptions = [180, 300, 480, "Custom"];

const getStopwatchMilliSeconds = (
	currentStopwatch: CurrentWorkoutStopwatch,
) => {
	if (!currentStopwatch) return 0;
	let total = 0;
	for (const duration of currentStopwatch) {
		total += dayjsLib(duration.to).diff(duration.from);
	}
	return total;
};

const TimerAndStopwatchDrawer = (props: {
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

const ReorderDrawer = (props: {
	opened: boolean;
	onClose: () => void;
	exerciseToReorder: string | null | undefined;
}) => {
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
			size="sm"
			styles={styles}
			opened={props.opened}
			onClose={props.onClose}
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
							{exerciseElements.map((exercise, index) => (
								<ReorderDrawerExerciseElement
									index={index}
									exercise={exercise}
									key={exercise.identifier}
									exerciseToReorder={props.exerciseToReorder}
								/>
							))}
							{provided.placeholder}
						</Stack>
					)}
				</Droppable>
			</DragDropContext>
		</Drawer>
	) : null;
};

const ReorderDrawerExerciseElement = (props: {
	index: number;
	exercise: Exercise;
	exerciseToReorder: string | null | undefined;
}) => {
	const [currentWorkout] = useCurrentWorkout();
	const isForThisExercise =
		props.exerciseToReorder === props.exercise.identifier;

	invariant(currentWorkout);

	const { data: exerciseDetails } = useQuery(
		getExerciseDetailsQuery(props.exercise.exerciseId),
	);

	return (
		<Draggable index={props.index} draggableId={props.index.toString()}>
			{(provided) => (
				<Paper
					py={6}
					px="sm"
					withBorder
					radius="md"
					ref={provided.innerRef}
					{...provided.draggableProps}
					{...provided.dragHandleProps}
				>
					<Group justify="space-between" wrap="nowrap">
						<Text size="sm" c={isForThisExercise ? "teal" : undefined}>
							{exerciseDetails?.name}
						</Text>
						<ThemeIcon
							size="xs"
							variant="transparent"
							color={isForThisExercise ? "teal" : "gray"}
						>
							{match(getProgressOfExercise(currentWorkout, props.index))
								.with("complete", () => <IconDropletFilled />)
								.with("in-progress", () => <IconDropletHalf2Filled />)
								.with("not-started", () => <IconDroplet />)
								.exhaustive()}
						</ThemeIcon>
					</Group>
				</Paper>
			)}
		</Draggable>
	);
};

const NoteInput = (props: {
	note: string;
	noteIdx: number;
	exerciseIdx: number;
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
				autosize
				size="xs"
				minRows={1}
				maxRows={4}
				style={{ flexGrow: 1 }}
				placeholder="Add a note"
				defaultValue={props.note}
				onChange={(e) => setValue(e.currentTarget.value)}
			/>
			<ActionIcon
				color="red"
				onClick={() => {
					openConfirmationModal(
						"This note will be deleted. Are you sure you want to continue?",
						() => {
							if (currentWorkout)
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										draft.exercises[props.exerciseIdx].notes.splice(
											props.noteIdx,
											1,
										);
									}),
								);
						},
					);
				}}
			>
				<IconTrash size={20} />
			</ActionIcon>
		</Flex>
	);
};
