import { Text } from "@mantine/core";
import {
	ExerciseLot,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";
import type { ExerciseSetStats } from "../lib/workout";

export const getSetStatisticsTextToDisplay = (
	lot: ExerciseLot,
	statistic: WorkoutSetStatistic | ExerciseSetStats,
) => {
	return match(lot)
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${Number(statistic.duration).toFixed(2)} km for ${Number(
				statistic.duration,
			).toFixed(2)} min`,
			`${(
				(Number(statistic.distance) || 1) / (Number(statistic.duration) || 1)
			).toFixed(2)} km/min`,
		])
		.with(ExerciseLot.Duration, () => [`${statistic.duration} min`, undefined])
		.with(ExerciseLot.RepsAndWeight, () => [
			statistic.weight && statistic.weight !== "0"
				? `${statistic.weight} kg  × ${statistic.reps}`
				: `${statistic.reps} reps`,
			`${Number(statistic.oneRm).toFixed(1)} RM`,
		])
		.exhaustive();
};

/**
 * Display statistics for an exercise set.
 **/
export const DisplayExerciseStats = (props: {
	lot: ExerciseLot;
	statistic: ExerciseSetStats | WorkoutSetStatistic;
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
