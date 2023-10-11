import { Text } from "@mantine/core";
import {
	ExerciseLot,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";

export const getSetStatisticsTextToDisplay = (
	lot: ExerciseLot,
	statistic: WorkoutSetStatistic,
) => {
	return match(lot)
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${statistic.duration} km x ${statistic.duration} min`,
			`${(statistic.distance || 1) / (statistic.duration || 1)} km/min`,
		])
		.with(ExerciseLot.Duration, () => [`${statistic.duration} min`, undefined])
		.with(ExerciseLot.RepsAndWeight, () => [
			`${statistic.weight} kg x ${statistic.reps}`,
			`${(statistic.weight || 1) * (statistic.reps || 1)} vol`,
		])
		.exhaustive();
};

/**
 * Display statistics for an exercise set.
 **/
export const DisplayExerciseStats = (props: {
	lot: ExerciseLot;
	statistic: WorkoutSetStatistic;
	hideExtras?: boolean;
}) => {
	const [first, second] = getSetStatisticsTextToDisplay(
		props.lot,
		props.statistic,
	);
	return (
		<>
			<Text fz={props.hideExtras ? "xs" : "sm"}>{first}</Text>
			{!props.hideExtras && second ? (
				<Text ml="auto" fz={props.hideExtras ? "xs" : "sm"}>
					{second}
				</Text>
			) : undefined}
		</>
	);
};
