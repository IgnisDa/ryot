import { ActionIcon, Transition } from "@mantine/core";
import { IconCheck, IconStopwatch } from "@tabler/icons-react";
import clsx from "clsx";
import { produce } from "immer";
import invariant from "tiny-invariant";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useCurrentWorkout,
	useGetExerciseAtIndex,
	useGetSetAtIndex,
} from "~/lib/state/fitness";
import { OnboardingTourStepTargets } from "~/lib/state/general";
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

export const SetActionButton = (props: SetActionButtonProps) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	invariant(exercise);
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	invariant(set);

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
				) : (
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
				)
			}
		</Transition>
	);
};
