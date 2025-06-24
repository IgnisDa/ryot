import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Box,
	Divider,
	Flex,
	Group,
	Menu,
	Paper,
	Text,
	TextInput,
	Transition,
	UnstyledButton,
} from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { SetLot } from "@ryot/generated/graphql/backend/graphql";
import { isString, snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconCheck,
	IconClipboard,
	IconHeartSpark,
	IconStopwatch,
	IconTrash,
	IconZzz,
} from "@tabler/icons-react";
import clsx from "clsx";
import { produce } from "immer";
import { useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { DisplaySetStatistics } from "~/components/fitness";
import {
	PRO_REQUIRED_MESSAGE,
	dayjsLib,
	getSetColor,
	openConfirmationModal,
} from "~/lib/common";
import { useCoreDetails, useUserPreferences } from "~/lib/hooks";
import {
	getRestTimerForSet,
	useCurrentWorkout,
	useCurrentWorkoutTimerAtom,
	useGetExerciseAtIndex,
	useGetSetAtIndex,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import { StatInput } from "../StatDisplayAndInput";
import type { FuncStartTimer } from "../types";
import { formatTimerDuration } from "../utils";
import { RpeModal } from "./RpeModal";
import {
	isSetConfirmationDisabled,
	usePreviousSetData,
	useSetConfirmationHandler,
} from "./functions";
import { DisplaySetRestTimer, EditSetRestTimer } from "./support";

export const SetDisplay = (props: {
	setIdx: number;
	repsCol: boolean;
	weightCol: boolean;
	exerciseIdx: number;
	durationCol: boolean;
	distanceCol: boolean;
	stopTimer: () => void;
	isWorkoutPaused: boolean;
	startTimer: FuncStartTimer;
	isCreatingTemplate: boolean;
	openTimerDrawer: () => void;
	toBeDisplayedColumns: number;
}) => {
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const [currentTimer, _] = useCurrentWorkoutTimerAtom();
	const [parent] = useAutoAnimate();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	invariant(set);
	const [isEditingRestTimer, setIsEditingRestTimer] = useState(false);
	const [isRpeModalOpen, setIsRpeModalOpen] = useState(false);
	const [value, setValue] = useDebouncedState(set.note || "", 500);
	const { data: previousSetData } = usePreviousSetData(
		props.setIdx,
		props.exerciseIdx,
		currentWorkout,
		exercise.exerciseId,
	);
	const { isOnboardingTourInProgress, advanceOnboardingTourStep } =
		useOnboardingTour();

	const handleSetConfirmation = useSetConfirmationHandler({
		setIdx: props.setIdx,
		stopTimer: props.stopTimer,
		startTimer: props.startTimer,
		exerciseIdx: props.exerciseIdx,
		isWorkoutPaused: props.isWorkoutPaused,
	});

	const closeRpeModal = () => setIsRpeModalOpen(false);

	useDidUpdate(() => {
		if (isString(value))
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					draft.exercises[props.exerciseIdx].sets[props.setIdx].note = value;
				}),
			);
	}, [value]);

	const didCurrentSetActivateTimer =
		currentTimer?.triggeredBy?.exerciseIdentifier === exercise.identifier &&
		currentTimer?.triggeredBy?.setIdentifier === set.identifier;
	const hasRestTimerOfThisSetElapsed = set.restTimer?.hasElapsed;
	const isOnboardingTourStep =
		isOnboardingTourInProgress &&
		set.confirmedAt === null &&
		props.exerciseIdx === 0 &&
		props.setIdx === 0;

	return (
		<>
			<RpeModal
				currentRpe={set.rpe}
				setIdx={props.setIdx}
				onClose={closeRpeModal}
				opened={isRpeModalOpen}
				exerciseIdx={props.exerciseIdx}
			/>
			<Paper id={`${props.exerciseIdx}-${props.setIdx}`}>
				<Flex justify="space-between" align="center" py={4}>
					<Menu>
						<Menu.Target>
							<UnstyledButton
								w="5%"
								onClick={() => {
									if (isOnboardingTourStep) advanceOnboardingTourStep();
								}}
								className={clsx(
									isOnboardingTourStep &&
										OnboardingTourStepTargets.OpenSetMenuDetails,
								)}
							>
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
								fz="xs"
								color="red"
								leftSection={<IconTrash size={14} />}
								onClick={() => {
									const deleteCurrentSet = () => {
										setCurrentWorkout(
											produce(currentWorkout, (draft) => {
												draft.exercises[props.exerciseIdx].sets.splice(
													props.setIdx,
													1,
												);
											}),
										);
									};
									match(set.confirmedAt)
										.with(null, deleteCurrentSet)
										.otherwise(() =>
											openConfirmationModal(
												"Are you sure you want to delete this set?",
												deleteCurrentSet,
											),
										);
								}}
							>
								Delete set
							</Menu.Item>
						</Menu.Dropdown>
					</Menu>
					<Box
						ta="center"
						w={`${(props.isCreatingTemplate ? 95 : 85) / props.toBeDisplayedColumns}%`}
					>
						{previousSetData ? (
							<Box
								style={{ cursor: "pointer" }}
								onClick={() => {
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											const idxToTarget = set.confirmedAt
												? props.setIdx + 1
												: props.setIdx;
											const setToTarget =
												draft.exercises[props.exerciseIdx].sets[idxToTarget];
											if (setToTarget) setToTarget.statistic = previousSetData;
										}),
									);
								}}
							>
								<DisplaySetStatistics
									hideExtras
									centerText
									lot={exercise.lot}
									statistic={previousSetData}
									unitSystem={exercise.unitSystem}
								/>
							</Box>
						) : (
							"—"
						)}
					</Box>
					{props.durationCol ? (
						<StatInput
							inputStep={0.1}
							stat="duration"
							setIdx={props.setIdx}
							exerciseIdx={props.exerciseIdx}
						/>
					) : null}
					{props.distanceCol ? (
						<StatInput
							inputStep={0.01}
							stat="distance"
							setIdx={props.setIdx}
							exerciseIdx={props.exerciseIdx}
						/>
					) : null}
					{props.weightCol ? (
						<StatInput
							stat="weight"
							setIdx={props.setIdx}
							exerciseIdx={props.exerciseIdx}
						/>
					) : null}
					{props.repsCol ? (
						<StatInput
							stat="reps"
							setIdx={props.setIdx}
							exerciseIdx={props.exerciseIdx}
						/>
					) : null}
					<Group
						w="10%"
						justify="center"
						style={props.isCreatingTemplate ? { display: "none" } : undefined}
					>
						<Transition
							mounted
							duration={200}
							timingFunction="ease-in-out"
							transition={{
								in: {},
								out: {},
								transitionProperty: "all",
							}}
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
												setIdentifier: set.identifier,
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
										onClick={handleSetConfirmation}
										variant={set.confirmedAt ? "filled" : "outline"}
										disabled={isSetConfirmationDisabled(
											exercise.lot,
											set.statistic,
										)}
										className={clsx(
											isOnboardingTourStep &&
												OnboardingTourStepTargets.ConfirmSetForExercise,
										)}
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
