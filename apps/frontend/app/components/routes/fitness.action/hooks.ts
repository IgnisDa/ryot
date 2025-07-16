import type {
	ExerciseDetailsQuery,
	UserExerciseDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, sortBy } from "@ryot/ts-utils";
import { Howl } from "howler";
import { produce } from "immer";
import { useMemo } from "react";
import { useUserPreferences } from "~/lib/shared/hooks";
import { queryClient } from "~/lib/shared/query-factory";
import {
	type InProgressWorkout,
	getExerciseDetailsQuery,
	getExerciseImages,
	getUserExerciseDetailsQuery,
	useCurrentWorkout,
} from "~/lib/state/fitness";
import { DEFAULT_SET_TIMEOUT_DELAY_MS } from "./utils";

export const focusOnExercise = (idx: number) => {
	setTimeout(() => {
		const exercise = document.getElementById(idx.toString());
		exercise?.scrollIntoView({ behavior: "smooth" });
	}, DEFAULT_SET_TIMEOUT_DELAY_MS);
};

export const getProgressOfExercise = (cw: InProgressWorkout, index: number) => {
	const isCompleted = cw.exercises[index].sets.every((s) => s.confirmedAt);
	return isCompleted
		? ("complete" as const)
		: cw.exercises[index].sets.some((s) => s.confirmedAt)
			? ("in-progress" as const)
			: ("not-started" as const);
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

const exerciseHasDetailsToShow = (
	details?: ExerciseDetails,
	userDetails?: UserExerciseDetails,
) => {
	const images = getExerciseImages(details);
	return (images.length || 0) > 0 || (userDetails?.history?.length || 0) > 0;
};

export const usePerformTasksAfterSetConfirmed = () => {
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
					if (isNumber(nextSet.exerciseIdx)) {
						const nextExercise = draft.exercises[nextSet.exerciseIdx];
						const nextExerciseHasDetailsToShow =
							nextExercise &&
							exerciseHasDetailsToShow(exerciseDetails, userExerciseDetails);
						if (nextExerciseHasDetailsToShow) {
							nextExercise.isCollapsed = false;
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

export const usePlayFitnessSound = (fileName: string) => {
	const userPreferences = useUserPreferences();
	const sound = useMemo(() => new Howl({ src: [`/sounds/${fileName}`] }), []);

	const playSound = () => {
		if (!userPreferences.fitness.logging.muteSounds) sound.play();
	};

	return playSound;
};
