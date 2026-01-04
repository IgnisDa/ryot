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
	ExerciseDurationUnit,
	ExerciseLot,
	SetLot,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconChevronUp,
	IconCirclesRelation,
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
import { getDurationUnitLabel } from "~/components/fitness/utils";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
	useExerciseDetails,
	useUserExerciseDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import {
	getRestTimerForSet,
	useCurrentWorkout,
	useCurrentWorkoutTimerAtom,
	useGetExerciseAtIndex,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTarget,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import {
	focusOnExercise,
	getProgressOfExercise,
	sortSupersetExercisesByWorkoutOrder,
	usePlayFitnessSound,
} from "../hooks";
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
	playCheckSound: () => void;
	openTimerDrawer: () => void;
	isCreatingTemplate: boolean;
	openSupersetModal: (s: string) => void;
	setOpenAssetsModal: (identifier: string) => void;
	reorderDrawerToggle: (exerciseIdentifier: string | null) => void;
	openBulkDeleteModal: (exerciseIdentifier: string | null) => void;
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

	const { advanceOnboardingTourStep } = useOnboardingTour();
	const [
		isDetailsModalOpen,
		{ open: openDetailsModal, close: closeDetailsModal },
	] = useDisclosure(false);

	const playAddSetSound = usePlayFitnessSound("add-set");

	const selectedUnitSystem = exercise.unitSystem;
	const durationUnit =
		userExerciseDetails?.details?.exerciseExtraInformation?.settings
			.defaultDurationUnit || ExerciseDurationUnit.Minutes;
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
				style={{ scrollMargin: exercise.scrollMarginRemoved ? "10px" : "60px" }}
			>
				<Stack ref={parent}>
					<Menu shadow="md" width={200} position="left-end">
						<Group justify="space-between" pos="relative" wrap="nowrap">
							<Group wrap="nowrap" gap="xs">
								{partOfSuperset ? (
									<ActionIcon
										size="sm"
										variant="light"
										color={theme.colors[partOfSuperset.color][6]}
										onClick={() => {
											const sortedExercises =
												sortSupersetExercisesByWorkoutOrder(
													partOfSuperset.exercises,
													currentWorkout.exercises,
												);
											const currentIdx = sortedExercises.indexOf(
												exercise.identifier,
											);
											const nextIdx = (currentIdx + 1) % sortedExercises.length;
											const nextExerciseIdentifier = sortedExercises[nextIdx];
											const nextExerciseIdx =
												currentWorkout.exercises.findIndex(
													(e) => e.identifier === nextExerciseIdentifier,
												);
											if (nextExerciseIdx !== -1)
												focusOnExercise(nextExerciseIdx);
										}}
									>
										<IconCirclesRelation
											style={{ width: "90%", height: "90%" }}
										/>
									</ActionIcon>
								) : null}
								<Anchor
									c="blue"
									fw="bold"
									lineClamp={1}
									fz={{ base: "sm", md: "md" }}
									onClick={(e) => {
										e.preventDefault();
										openDetailsModal();
									}}
								>
									{exerciseDetails?.name || "Loading..."}
								</Anchor>
							</Group>
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
												OnboardingTourStepTarget.OpenExerciseMenuDetails,
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
								onClick={() => props.openBulkDeleteModal(exercise.identifier)}
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
										DURATION ({getDurationUnitLabel(durationUnit)})
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
									durationUnit={durationUnit}
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
