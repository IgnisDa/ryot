import type {
	ExerciseDetailsQuery,
	UserExerciseDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { sortBy } from "@ryot/ts-utils";
import { $path } from "safe-routes";
import { dayjsLib } from "~/lib/common";
import type {
	CurrentWorkoutStopwatch,
	InProgressWorkout,
} from "~/lib/state/fitness";
import { getExerciseImages } from "~/lib/state/fitness";

type ExerciseDetails = ExerciseDetailsQuery["exerciseDetails"];
type UserExerciseDetails = UserExerciseDetailsQuery["userExerciseDetails"];

export const formatTimerDuration = (duration: number) =>
	dayjsLib.duration(duration).format("mm:ss");

export const getStopwatchMilliSeconds = (
	currentStopwatch: CurrentWorkoutStopwatch,
) => {
	if (!currentStopwatch) return 0;
	let total = 0;
	for (const duration of currentStopwatch) {
		total += dayjsLib(duration.to).diff(duration.from);
	}
	return total;
};

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

export const deleteUploadedAsset = (key: string) => {
	const formData = new FormData();
	formData.append("key", key);
	fetch($path("/actions", { intent: "deleteS3Asset" }), {
		method: "POST",
		body: formData,
	});
};

export const getNextSetInWorkout = (
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

export const focusOnExercise = (idx: number) => {
	setTimeout(() => {
		const exercise = document.getElementById(idx.toString());
		exercise?.scrollIntoView({ behavior: "smooth" });
	}, 800);
};

export const exerciseHasDetailsToShow = (
	details?: ExerciseDetails,
	userDetails?: UserExerciseDetails,
) => {
	const images = getExerciseImages(details);
	return (images.length || 0) > 0 || (userDetails?.history?.length || 0) > 0;
};

export const getProgressOfExercise = (cw: InProgressWorkout, index: number) => {
	const isCompleted = cw.exercises[index].sets.every((s) => s.confirmedAt);
	return isCompleted
		? ("complete" as const)
		: cw.exercises[index].sets.some((s) => s.confirmedAt)
			? ("in-progress" as const)
			: ("not-started" as const);
};
