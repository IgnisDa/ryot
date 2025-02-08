import {
	ExerciseLot,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { isString } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useUserExerciseDetails, useUserPreferences } from "~/lib/shared/hooks";
import {
	type CurrentWorkout,
	type CurrentWorkoutTimer,
	type Exercise,
	type ExerciseSet,
	getWorkoutDetails,
	type InProgressWorkout,
	useCurrentWorkout,
	useCurrentWorkoutTimerAtom,
	useGetExerciseAtIndex,
	useGetSetAtIndex,
} from "~/lib/state/fitness";
import { useOnboardingTour } from "~/lib/state/onboarding-tour";
import { FitnessAction } from "~/lib/types";
import { usePerformTasksAfterSetConfirmed } from "../hooks";
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
		if (currentWorkout.exercises[i].exerciseId === exerciseId)
			globalIndex += currentWorkout.exercises[i].sets.length;
	}
	globalIndex += setIdx;
	return globalIndex;
};

export const usePreviousSetData = (input: {
	setIdx: number;
	exerciseId: string;
	exerciseIdx: number;
	currentWorkout: InProgressWorkout;
}) => {
	const { data: userExerciseDetails } = useUserExerciseDetails(
		input.exerciseId,
	);

	return useQuery({
		enabled: !!userExerciseDetails,
		queryKey: [
			"previousSetData",
			`exercise-${input.exerciseIdx}`,
			`set-${input.setIdx}`,
			userExerciseDetails?.history,
		],
		queryFn: async () => {
			const globalSetIndex = getGlobalSetIndex(
				input.setIdx,
				input.exerciseIdx,
				input.currentWorkout,
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

export const handleSetConfirmation = async (params: {
	setIdx: number;
	exerciseIdx: number;
	stopTimer: () => void;
	isWorkoutPaused: boolean;
	startTimer: FuncStartTimer;
	playCheckSound: () => void;
	set: ExerciseSet | undefined;
	currentWorkout: CurrentWorkout;
	exercise: Exercise | undefined;
	advanceOnboardingTourStep: () => void;
	currentTimer: CurrentWorkoutTimer | null;
	userPreferences: ReturnType<typeof useUserPreferences>;
	setCurrentWorkout: (workout: InProgressWorkout) => void;
	performTasksAfterSetConfirmed: ReturnType<
		typeof usePerformTasksAfterSetConfirmed
	>;
}) => {
	const {
		set,
		setIdx,
		exercise,
		stopTimer,
		startTimer,
		exerciseIdx,
		currentTimer,
		playCheckSound,
		currentWorkout,
		userPreferences,
		isWorkoutPaused,
		setCurrentWorkout,
		advanceOnboardingTourStep,
		performTasksAfterSetConfirmed,
	} = params;

	if (!currentWorkout || !exercise || !set) return;

	playCheckSound();
	const newConfirmed = !set.confirmedAt;

	const promptForRestTimer = userPreferences.fitness.logging.promptForRestTimer;
	const isOnboardingTourStep =
		set?.confirmedAt === null && exerciseIdx === 0 && setIdx === 0;

	if (isOnboardingTourStep && newConfirmed) advanceOnboardingTourStep();

	if (
		!newConfirmed &&
		currentTimer?.triggeredBy?.exerciseIdentifier === exercise.identifier &&
		currentTimer?.triggeredBy?.setIdentifier === set.identifier
	) {
		stopTimer();
	}

	if (set.restTimer && newConfirmed && !promptForRestTimer) {
		startTimer({
			duration: set.restTimer.duration,
			triggeredBy: {
				setIdentifier: set.identifier,
				exerciseIdentifier: exercise.identifier,
			},
		});
	}

	setCurrentWorkout(
		produce(currentWorkout, (draft) => {
			if (isWorkoutPaused) {
				draft.durations.push({
					from: dayjsLib().toISOString(),
				});
			}
			const currentExercise = draft.exercises[exerciseIdx];
			const currentSet = currentExercise.sets[setIdx];
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
		await performTasksAfterSetConfirmed(setIdx, exerciseIdx);
	}
};

export const useSetConfirmationHandler = (props: {
	setIdx: number;
	exerciseIdx: number;
	stopTimer: () => void;
	isWorkoutPaused: boolean;
	playCheckSound: () => void;
	startTimer: FuncStartTimer;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [currentTimer] = useCurrentWorkoutTimerAtom();
	const userPreferences = useUserPreferences();
	const exercise = useGetExerciseAtIndex(props.exerciseIdx);
	const performTasksAfterSetConfirmed = usePerformTasksAfterSetConfirmed();
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	const { advanceOnboardingTourStep } = useOnboardingTour();

	return () =>
		handleSetConfirmation({
			set,
			exercise,
			currentTimer,
			currentWorkout,
			userPreferences,
			setCurrentWorkout,
			setIdx: props.setIdx,
			advanceOnboardingTourStep,
			stopTimer: props.stopTimer,
			startTimer: props.startTimer,
			performTasksAfterSetConfirmed,
			exerciseIdx: props.exerciseIdx,
			playCheckSound: props.playCheckSound,
			isWorkoutPaused: props.isWorkoutPaused,
		});
};
