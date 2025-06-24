import type { WorkoutSetStatistic } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import {
	type InProgressWorkout,
	getUserExerciseDetailsQuery,
	getWorkoutDetails,
} from "~/lib/state/fitness";

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
