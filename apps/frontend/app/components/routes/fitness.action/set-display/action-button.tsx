import { ActionIcon, Transition } from "@mantine/core";
import { ExerciseLot } from "@ryot/generated/graphql/backend/graphql";
import { isString } from "@ryot/ts-utils";
import { IconCheck, IconPlayerPlay, IconStopwatch } from "@tabler/icons-react";
import clsx from "clsx";
import { produce } from "immer";
import invariant from "tiny-invariant";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	type ExerciseSet,
	useCurrentWorkout,
	useGetExerciseAtIndex,
	useGetSetAtIndex,
} from "~/lib/state/fitness";
import { OnboardingTourStepTargets } from "~/lib/state/general";
import { usePlayFitnessSound } from "../hooks";
import type { FuncStartTimer } from "../types";
import {
	isSetConfirmationDisabled,
	useSetConfirmationHandler,
} from "./functions";

interface SetActionButtonProps {
	setIdx: number;
	exerciseIdx: number;
	stopTimer: () => void;
	isWorkoutPaused: boolean;
	startTimer: FuncStartTimer;
	isOnboardingTourStep: boolean;
}

const shouldShowPlayButton = (exerciseLot: ExerciseLot, set: ExerciseSet) => {
	const durationBasedLots = [
		ExerciseLot.DistanceAndDuration,
		ExerciseLot.Duration,
		ExerciseLot.RepsAndDuration,
		ExerciseLot.RepsAndDurationAndDistance,
	];
	return (
		durationBasedLots.includes(exerciseLot) &&
		!set.confirmedAt &&
		!set.displayConfirmTrigger &&
		isString(set.statistic.duration)
	);
};

export const SetActionButton = (props: SetActionButtonProps) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	invariant(set);

	const setIdentifier = {
		setIdentifier: set.identifier,
		exerciseIdentifier: exercise.identifier,
	};

	const timerStartedSound = usePlayFitnessSound("timer-started");

	const handleSetConfirmation = useSetConfirmationHandler({
		setIdx: props.setIdx,
		stopTimer: props.stopTimer,
		startTimer: props.startTimer,
		exerciseIdx: props.exerciseIdx,
		isWorkoutPaused: props.isWorkoutPaused,
	});

	return (
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
			{(style) => {
				if (shouldShowPlayButton(exercise.lot, set)) {
					return (
						<ActionIcon
							color="blue"
							style={style}
							variant="outline"
							onClick={() => {
								timerStartedSound();
								props.startTimer({
									confirmSetOnFinish: setIdentifier,
									duration: dayjsLib
										.duration(Number(set.statistic.duration), "minute")
										.asSeconds(),
								});
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										const currentExercise = draft.exercises[props.exerciseIdx];
										const currentSet = currentExercise.sets[props.setIdx];
										currentSet.displayConfirmTrigger = true;
									}),
								);
							}}
						>
							<IconPlayerPlay />
						</ActionIcon>
					);
				}

				if (set.displayRestTimeTrigger) {
					return (
						<ActionIcon
							color="blue"
							style={style}
							variant="outline"
							onClick={() => {
								invariant(set.restTimer);
								props.startTimer({
									triggeredBy: setIdentifier,
									duration: set.restTimer.duration,
								});
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										const currentExercise = draft.exercises[props.exerciseIdx];
										const currentSet = currentExercise.sets[props.setIdx];
										currentSet.displayRestTimeTrigger = false;
										currentSet.restTimerStartedAt = dayjsLib().toISOString();
									}),
								);
							}}
						>
							<IconStopwatch />
						</ActionIcon>
					);
				}

				return (
					<ActionIcon
						color="green"
						style={style}
						onClick={handleSetConfirmation}
						variant={set.confirmedAt ? "filled" : "outline"}
						disabled={isSetConfirmationDisabled(exercise.lot, set.statistic)}
						className={clsx(
							props.isOnboardingTourStep &&
								OnboardingTourStepTargets.ConfirmSetForExercise,
						)}
					>
						<IconCheck />
					</ActionIcon>
				);
			}}
		</Transition>
	);
};
