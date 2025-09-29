import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Flex,
	Group,
	Menu,
	Paper,
	Stack,
	Text,
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	ExerciseLot,
	SetLot,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconChevronUp,
	IconClipboard,
	IconDotsVertical,
	IconLayersIntersect,
	IconPhoto,
	IconReorder,
	IconReplace,
	IconTrash,
} from "@tabler/icons-react";
import clsx from "clsx";
import { produce } from "immer";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { v4 as randomUUID } from "uuid";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
	useDeleteS3AssetMutation,
	useExerciseDetails,
	useUserExerciseDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	getRestTimerForSet,
	useCurrentWorkout,
	useCurrentWorkoutTimerAtom,
	useGetExerciseAtIndex,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { getProgressOfExercise, usePlayFitnessSound } from "../hooks";
import { SetDisplay } from "../set-display/display";
import type { FuncStartTimer } from "../types";
import { ExerciseDetailsModal } from "./details-modal";
import { NoteInput } from "./note-input";
import { DisplayExerciseSetRestTimer } from "./set-rest-timer";

export const ExerciseDisplay = (props: {
	exerciseIdx: number;
	stopTimer: () => void;
	isWorkoutPaused: boolean;
	startTimer: FuncStartTimer;
	isCreatingTemplate: boolean;
	playCheckSound: () => void;
	openTimerDrawer: () => void;
	openSupersetModal: (s: string) => void;
	setOpenAssetsModal: (identifier: string) => void;
	reorderDrawerToggle: (exerciseIdentifier: string | null) => void;
}) => {
	const theme = useMantineTheme();
	const userPreferences = useUserPreferences();
	const navigate = useNavigate();
	const [parent] = useAutoAnimate();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);
	const [currentTimer, _] = useCurrentWorkoutTimerAtom();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const coreDetails = useCoreDetails();
	const { data: exerciseDetails } = useExerciseDetails(exercise.exerciseId);
	const { data: userExerciseDetails } = useUserExerciseDetails(
		exercise.exerciseId,
	);
	const deleteS3AssetMutation = useDeleteS3AssetMutation();

	const { advanceOnboardingTourStep } = useOnboardingTour();
	const [
		isDetailsModalOpen,
		{ open: openDetailsModal, close: closeDetailsModal },
	] = useDisclosure(false);

	const playAddSetSound = usePlayFitnessSound("add-set");

	const selectedUnitSystem = exercise.unitSystem;
	const isOnboardingTourStep = props.exerciseIdx === 0;
	const [durationCol, distanceCol, weightCol, repsCol] = match(exercise.lot)
		.with(ExerciseLot.Reps, () => [false, false, false, true])
		.with(ExerciseLot.Duration, () => [true, false, false, false])
		.with(ExerciseLot.RepsAndWeight, () => [false, false, true, true])
		.with(ExerciseLot.RepsAndDuration, () => [true, false, false, true])
		.with(ExerciseLot.DistanceAndDuration, () => [true, true, false, false])
		.with(ExerciseLot.RepsAndDurationAndDistance, () => [
			true,
			true,
			false,
			true,
		])
		.exhaustive();
	const toBeDisplayedColumns =
		[durationCol, distanceCol, weightCol, repsCol].filter(Boolean).length + 1;

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
			<ExerciseDetailsModal
				opened={isDetailsModalOpen}
				onClose={closeDetailsModal}
				exerciseIdx={props.exerciseIdx}
				exerciseId={exercise.exerciseId}
				exerciseDetails={exerciseDetails}
				exerciseName={exerciseDetails?.name}
				selectedUnitSystem={selectedUnitSystem}
				userExerciseDetails={userExerciseDetails}
			/>
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
								c="blue"
								fw="bold"
								lineClamp={1}
								onClick={(e) => {
									e.preventDefault();
									openDetailsModal();
								}}
							>
								{exerciseDetails?.name || "Loading..."}
							</Anchor>
							<Group wrap="nowrap" mr={-10}>
								{didExerciseActivateTimer ? (
									<DisplayExerciseSetRestTimer
										openTimerDrawer={props.openTimerDrawer}
									/>
								) : null}
								<ActionIcon
									variant="transparent"
									onClick={() => toggleExerciseCollapse()}
									style={{
										transition: "rotate 0.3s",
										rotate: exercise.isCollapsed ? "180deg" : undefined,
									}}
									color={match(exerciseProgress)
										.with("complete", () => "green")
										.with("in-progress", () => "blue")
										.otherwise(() => undefined)}
								>
									<IconChevronUp />
								</ActionIcon>
								<Menu.Target>
									<ActionIcon
										color="blue"
										onClick={() => {
											if (isOnboardingTourStep) advanceOnboardingTourStep();
										}}
										className={clsx(
											isOnboardingTourStep &&
												OnboardingTourStepTargets.OpenExerciseMenuDetails,
										)}
									>
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
								onClick={() => props.setOpenAssetsModal(exercise.identifier)}
								style={
									props.isCreatingTemplate ? { display: "none" } : undefined
								}
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
											for (const asset of assets) deleteS3AssetMutation.mutate(asset);

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
							<Flex justify="space-between" align="center">
								<Text size="xs" w="5%" ta="center">
									SET
								</Text>
								<Text
									size="xs"
									ta="center"
									w={`${(props.isCreatingTemplate ? 95 : 85) / toBeDisplayedColumns}%`}
								>
									PREVIOUS
								</Text>
								{durationCol ? (
									<Text size="xs" flex={1} ta="center">
										DURATION (MIN)
									</Text>
								) : null}
								{distanceCol ? (
									<Text size="xs" flex={1} ta="center">
										DISTANCE (
										{match(selectedUnitSystem)
											.with(UserUnitSystem.Metric, () => "KM")
											.with(UserUnitSystem.Imperial, () => "MI")
											.exhaustive()}
										)
									</Text>
								) : null}
								{weightCol ? (
									<Text size="xs" flex={1} ta="center">
										WEIGHT (
										{match(selectedUnitSystem)
											.with(UserUnitSystem.Metric, () => "KG")
											.with(UserUnitSystem.Imperial, () => "LB")
											.exhaustive()}
										)
									</Text>
								) : null}
								{repsCol ? (
									<Text size="xs" flex={1} ta="center">
										REPS
									</Text>
								) : null}
								<Box
									w="10%"
									style={
										props.isCreatingTemplate ? { display: "none" } : undefined
									}
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
									playCheckSound={props.playCheckSound}
									key={`${exercise.identifier}-${idx}`}
									isWorkoutPaused={props.isWorkoutPaused}
									openTimerDrawer={props.openTimerDrawer}
									toBeDisplayedColumns={toBeDisplayedColumns}
									isCreatingTemplate={props.isCreatingTemplate}
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
												identifier: randomUUID(),
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
