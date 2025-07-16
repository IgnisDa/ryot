import {
	ExerciseLot,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { isString } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useUserPreferences } from "~/lib/shared/hooks";
import {
	type InProgressWorkout,
	getUserExerciseDetailsQuery,
	getWorkoutDetails,
} from "~/lib/state/fitness";
import {
	useCurrentWorkout,
	useCurrentWorkoutTimerAtom,
	useGetExerciseAtIndex,
	useGetSetAtIndex,
} from "~/lib/state/fitness";
import { useOnboardingTour } from "~/lib/state/general";
import { FitnessAction } from "~/lib/types";
import {
	usePerformTasksAfterSetConfirmed,
	usePlayFitnessSound,
} from "../hooks";
import type { FuncStartTimer } from "../types";

export const getGlobalSetIndex = (
	setIdx: number,
	exerciseIdx: number,
	currentWorkout: InProgressWorkout,
) => {
	const exerciseId = currentWorkout.exercises[exerciseIdx].exerciseId;
	let globalIndex = 0;
	for (let i = 0; i < currentWorkout.exercises.length; i++) {
		if (i === exerciseIdx) break;
		if (currentWorkout.exercises[i].exerciseId === exerciseId) {
			globalIndex += currentWorkout.exercises[i].sets.length;
		}
	}
	globalIndex += setIdx;
	return globalIndex;
};

export const usePreviousSetData = (
	setIdx: number,
	exerciseIdx: number,
	currentWorkout: InProgressWorkout,
	exerciseId: string,
) => {
	const { data: userExerciseDetails } = useQuery(
		getUserExerciseDetailsQuery(exerciseId),
	);

	return useQuery({
		enabled: !!userExerciseDetails,
		queryKey: [
			"previousSetData",
			`exercise-${exerciseIdx}`,
			`set-${setIdx}`,
			userExerciseDetails?.history,
		],
		queryFn: async () => {
			const globalSetIndex = getGlobalSetIndex(
				setIdx,
				exerciseIdx,
				currentWorkout,
			);

			const allPreviousSets: WorkoutSetStatistic[] = [];

			for (const history of userExerciseDetails?.history || []) {
				if (allPreviousSets.length > globalSetIndex) break;
				const workout = await getWorkoutDetails(history.workoutId);
				const exercise = workout.details.information.exercises[history.idx];
				allPreviousSets.push(...exercise.sets.map((s) => s.statistic));
			}

			return allPreviousSets[globalSetIndex];
		},
	});
};

export const isSetConfirmationDisabled = (
	exerciseLot: ExerciseLot,
	setStatistic: WorkoutSetStatistic,
): boolean => {
	switch (exerciseLot) {
		case ExerciseLot.Reps:
			return !isString(setStatistic.reps);
		case ExerciseLot.Duration:
			return !isString(setStatistic.duration);
		case ExerciseLot.RepsAndDuration:
			return !isString(setStatistic.reps) || !isString(setStatistic.duration);
		case ExerciseLot.DistanceAndDuration:
			return (
				!isString(setStatistic.distance) || !isString(setStatistic.duration)
			);
		case ExerciseLot.RepsAndWeight:
			return !isString(setStatistic.reps) || !isString(setStatistic.weight);
		case ExerciseLot.RepsAndDurationAndDistance:
			return (
				!isString(setStatistic.reps) ||
				!isString(setStatistic.duration) ||
				!isString(setStatistic.distance)
			);
		default:
			return false;
	}
};

export const useSetConfirmationHandler = (props: {
	setIdx: number;
	exerciseIdx: number;
	stopTimer: () => void;
	startTimer: FuncStartTimer;
	isWorkoutPaused: boolean;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [currentTimer] = useCurrentWorkoutTimerAtom();
	const userPreferences = useUserPreferences();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	const performTasksAfterSetConfirmed = usePerformTasksAfterSetConfirmed();
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	const { isOnboardingTourInProgress, advanceOnboardingTourStep } =
		useOnboardingTour();

	const playCheckSound = usePlayFitnessSound("check.mp3");

	const promptForRestTimer = userPreferences.fitness.logging.promptForRestTimer;
	const isOnboardingTourStep =
		isOnboardingTourInProgress &&
		set?.confirmedAt === null &&
		props.exerciseIdx === 0 &&
		props.setIdx === 0;

	return async () => {
		if (!currentWorkout || !exercise || !set) return;

		playCheckSound();
		const newConfirmed = !set.confirmedAt;

		if (isOnboardingTourStep && newConfirmed) {
			advanceOnboardingTourStep();
		}

		if (
			!newConfirmed &&
			currentTimer?.triggeredBy?.exerciseIdentifier === exercise.identifier &&
			currentTimer?.triggeredBy?.setIdentifier === set.identifier
		) {
			props.stopTimer();
		}

		if (set.restTimer && newConfirmed && !promptForRestTimer) {
			props.startTimer(set.restTimer.duration, {
				setIdentifier: set.identifier,
				exerciseIdentifier: exercise.identifier,
			});
		}

		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				if (props.isWorkoutPaused) {
					draft.durations.push({
						from: dayjsLib().toISOString(),
					});
				}
				const currentExercise = draft.exercises[props.exerciseIdx];
				const currentSet = currentExercise.sets[props.setIdx];
				currentSet.confirmedAt = newConfirmed
					? currentWorkout.currentAction === FitnessAction.UpdateWorkout
						? true
						: dayjsLib().toISOString()
					: null;
				currentExercise.scrollMarginRemoved = true;
				if (newConfirmed && promptForRestTimer && set.restTimer) {
					currentSet.displayRestTimeTrigger = true;
				}
			}),
		);

		if (newConfirmed && !promptForRestTimer) {
			await performTasksAfterSetConfirmed(props.setIdx, props.exerciseIdx);
		}
	};
};
