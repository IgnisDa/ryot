import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Button,
	Container,
	Divider,
	FileButton,
	Group,
	Modal,
	NumberInput,
	SimpleGrid,
	Skeleton,
	Stack,
	Text,
	TextInput,
	Textarea,
} from "@mantine/core";
import { useDebouncedState, useDidUpdate, useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateOrUpdateUserWorkoutDocument,
	CreateOrUpdateUserWorkoutTemplateDocument,
	GetPresignedS3UrlDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	isNumber,
	isString,
	parseParameters,
	sum,
} from "@ryot/ts-utils";
import {
	IconCamera,
	IconLibraryPhoto,
	IconTrash,
	IconVideo,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Howl } from "howler";
import { produce } from "immer";
import { RESET } from "jotai/utils";
import { useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useInterval } from "usehooks-ts";
import { z } from "zod";
import { displayWeightWithUnit } from "~/components/fitness";
import { DEFAULT_SET_TIMEOUT_DELAY } from "~/components/fitness.action/constants";
import { ExerciseDisplay } from "~/components/fitness.action/exercise-display";
import {
	getProgressOfExercise,
	usePerformTasksAfterSetConfirmed,
} from "~/components/fitness.action/hooks";
import { ReorderDrawer } from "~/components/fitness.action/reorder";
import {
	RestTimer,
	WorkoutDurationTimer,
} from "~/components/fitness.action/rest-timer";
import { StatDisplay } from "~/components/fitness.action/stat-display-and-input";
import { DisplaySupersetModal } from "~/components/fitness.action/supersets";
import { TimerAndStopwatchDrawer } from "~/components/fitness.action/timer-and-stopwatch-drawer";
import { deleteUploadedAsset } from "~/components/fitness.action/utils";
import {
	FitnessAction,
	FitnessEntity,
	PRO_REQUIRED_MESSAGE,
	clientGqlService,
	clientSideFileUpload,
	dayjsLib,
	openConfirmationModal,
	postMessageToServiceWorker,
	queryClient,
	queryFactory,
	sendNotificationToServiceWorker,
} from "~/lib/common";
import {
	useApplicationEvents,
	useCoreDetails,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/hooks";
import {
	currentWorkoutToCreateWorkoutInput,
	getExerciseDetailsQuery,
	useCurrentWorkout,
	useCurrentWorkoutTimerAtom,
	useMeasurementsDrawerOpen,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import type { Route } from "./+types/_dashboard.fitness.$action";

export const loader = async ({ params }: Route.LoaderArgs) => {
	const { action } = parseParameters(
		params,
		z.object({ action: z.nativeEnum(FitnessAction) }),
	);
	return {
		action,
		isUpdatingWorkout: action === FitnessAction.UpdateWorkout,
		isCreatingTemplate: action === FitnessAction.CreateTemplate,
	};
};

export const meta = ({ data }: Route.MetaArgs) => {
	return [{ title: `${changeCase(data?.action || "")} | Ryot` }];
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
	const { advanceOnboardingTourStep, isOnboardingTourInProgress } =
		useOnboardingTour();

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
					const setIdx = currentWorkout?.exercises[exerciseIdx]?.sets.findIndex(
						(s) => s.identifier === triggeredBy.setIdentifier,
					);
					if (
						exerciseIdx !== -1 &&
						exerciseIdx !== undefined &&
						userPreferences.fitness.logging.promptForRestTimer
					) {
						performTasksAfterSetConfirmed(setIdx, exerciseIdx);
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
		triggeredBy?: { exerciseIdentifier: string; setIdentifier: string },
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
					if (exercise) {
						const setIdx = exercise.sets.findIndex(
							(s) => s.identifier === triggeredBy.setIdentifier,
						);
						const restTimer = exercise.sets[setIdx].restTimer;
						if (restTimer) restTimer.hasElapsed = true;
					}
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
									isCreatingTemplate={loaderData.isCreatingTemplate}
									openAssetsModal={() => setAssetsModalOpened(null)}
								/>
								<Group>
									<WorkoutDurationTimer
										isWorkoutPaused={isWorkoutPaused}
										isUpdatingWorkout={loaderData.isUpdatingWorkout}
										isCreatingTemplate={loaderData.isCreatingTemplate}
									/>
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
											className={clsx(
												isOnboardingTourInProgress &&
													OnboardingTourStepTargets.FinishWorkout,
											)}
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
														if (isOnboardingTourInProgress)
															advanceOnboardingTourStep();

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
																deleteUploadedAsset(asset);
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
										isCreatingTemplate={loaderData.isCreatingTemplate}
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
										onClick={() => advanceOnboardingTourStep()}
										to={$path("/fitness/exercises/list")}
										className={
											OnboardingTourStepTargets.ClickOnAddAnExerciseButton
										}
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
	isCreatingTemplate: boolean;
	openAssetsModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
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
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				draft.comment = comment || undefined;
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
					<NumberInput
						size="sm"
						value={currentWorkout.caloriesBurnt}
						label={`Energy burnt in ${userPreferences.fitness.logging.caloriesBurntUnit}`}
						onChange={(e) => setCaloriesBurnt(isNumber(e) ? e : undefined)}
					/>
					<Textarea
						size="sm"
						minRows={2}
						label="Comments"
						defaultValue={comment}
						placeholder="Your thoughts about this workout"
						onChange={(e) => setComment(e.currentTarget.value)}
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
						{!props.isCreatingTemplate ? (
							<Anchor
								size="xs"
								onClick={() => setIsCaloriesBurntModalOpen(true)}
							>
								More Information
							</Anchor>
						) : null}
					</Group>
				}
			/>
		</>
	);
};

const AssetDisplay = (props: {
	s3Key: string;
	type: "video" | "image";
	removeAsset: () => void;
}) => {
	const srcUrlQuery = useQuery({
		queryKey: queryFactory.miscellaneous.presignedS3Url(props.s3Key).queryKey,
		queryFn: () =>
			clientGqlService
				.request(GetPresignedS3UrlDocument, { key: props.s3Key })
				.then((v) => v.getPresignedS3Url),
	});

	return (
		<Box pos="relative">
			{props.type === "video" ? (
				<Link to={srcUrlQuery.data ?? ""} target="_blank">
					<Avatar size="lg" name="Video" />
				</Link>
			) : (
				<Avatar src={srcUrlQuery.data} size="lg" />
			)}
			<ActionIcon
				top={0}
				size="xs"
				left={-12}
				color="red"
				pos="absolute"
				onClick={() => {
					openConfirmationModal(
						"Are you sure you want to remove this video?",
						() => props.removeAsset(),
					);
				}}
			>
				<IconTrash />
			</ActionIcon>
		</Box>
	);
};

const UploadAssetsModal = (props: {
	closeModal: () => void;
	modalOpenedBy: string | null | undefined;
}) => {
	const coreDetails = useCoreDetails();
	const fileUploadAllowed = coreDetails.fileStorageEnabled;
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [isFileUploading, setIsFileUploading] = useState(false);

	if (!currentWorkout) return null;

	const afterFileSelected = async (
		file: File | null,
		type: "image" | "video",
	) => {
		if (props.modalOpenedBy === null && !coreDetails.isServerKeyValidated) {
			notifications.show({
				color: "red",
				message: PRO_REQUIRED_MESSAGE,
			});
			return;
		}
		if (!file) return;
		setIsFileUploading(true);
		try {
			const key = await clientSideFileUpload(file, "workouts");
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					if (type === "image") {
						if (exercise) draft.exercises[exerciseIdx].images.push(key);
						else draft.images.push(key);
					} else {
						if (exercise) draft.exercises[exerciseIdx].videos.push(key);
						else draft.videos.push(key);
					}
				}),
			);
		} catch {
			notifications.show({
				color: "red",
				message: `Error while uploading ${type}`,
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

	const imagesToDisplay = isString(props.modalOpenedBy)
		? exercise?.images || []
		: currentWorkout.images;

	const videosToDisplay = isString(props.modalOpenedBy)
		? exercise?.videos || []
		: currentWorkout.videos;

	const hasAssets = imagesToDisplay.length > 0 || videosToDisplay.length > 0;

	const onRemoveAsset = (key: string, type: "image" | "video") => {
		deleteUploadedAsset(key);
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				if (type === "image") {
					if (exerciseIdx !== -1) {
						draft.exercises[exerciseIdx].images = draft.exercises[
							exerciseIdx
						].images.filter((i) => i !== key);
					} else {
						draft.images = draft.images.filter((i) => i !== key);
					}
					return;
				}
				if (exerciseIdx !== -1) {
					draft.exercises[exerciseIdx].videos = draft.exercises[
						exerciseIdx
					].videos.filter((i) => i !== key);
				} else {
					draft.videos = draft.videos.filter((i) => i !== key);
				}
			}),
		);
	};

	return (
		<Modal
			onClose={() => props.closeModal()}
			opened={props.modalOpenedBy !== undefined}
			title={`Images for ${exerciseDetails ? exerciseDetails.name : "the workout"}`}
		>
			<Stack>
				{fileUploadAllowed ? (
					<>
						{hasAssets ? (
							<Avatar.Group spacing="xs">
								{imagesToDisplay.map((i) => (
									<AssetDisplay
										key={i}
										s3Key={i}
										type="image"
										removeAsset={() => onRemoveAsset(i, "image")}
									/>
								))}
								{videosToDisplay.map((i) => (
									<AssetDisplay
										key={i}
										s3Key={i}
										type="video"
										removeAsset={() => onRemoveAsset(i, "video")}
									/>
								))}
							</Avatar.Group>
						) : null}
						<Group justify="space-between">
							<FileButton
								accept="image/*"
								onChange={(file) => afterFileSelected(file, "image")}
							>
								{(props) => (
									<Button
										{...props}
										flex={1}
										color="cyan"
										variant="outline"
										loading={isFileUploading}
										leftSection={<IconLibraryPhoto />}
									>
										Image
									</Button>
								)}
							</FileButton>
							<FileButton
								accept="video/*"
								onChange={(file) => afterFileSelected(file, "video")}
							>
								{(props) => (
									<Button
										{...props}
										flex={1}
										color="cyan"
										variant="outline"
										loading={isFileUploading}
										leftSection={<IconVideo />}
									>
										Video
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
