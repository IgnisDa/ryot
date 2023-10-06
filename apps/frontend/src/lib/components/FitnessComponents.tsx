import { Text } from "@mantine/core";
import {
	ExerciseLot,
	type SetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";

/**
 * Display statistics for an exercise set.
 **/
export const DisplayExerciseStats = (props: {
	lot: ExerciseLot;
	statistic: SetStatistic;
	hideExtras?: boolean;
}) => {
	const [first, second] = match(props.lot)
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${props.statistic.duration} km x ${props.statistic.duration} min`,
			props.hideExtras
				? undefined
				: `${
						(props.statistic.distance || 1) / (props.statistic.duration || 1)
				  } km/min`,
		])
		.with(ExerciseLot.Duration, () => [
			`${props.statistic.duration} min`,
			undefined,
		])
		.with(ExerciseLot.RepsAndWeight, () => [
			`${props.statistic.weight} kg x ${props.statistic.reps}`,
			props.hideExtras
				? undefined
				: `${(props.statistic.weight || 1) * (props.statistic.reps || 1)} vol`,
		])
		.exhaustive();
	return (
		<>
			<Text fz="sm">{first}</Text>
			{second ? (
				<Text ml="auto" fz="sm">
					{second}
				</Text>
			) : undefined}
		</>
	);
};
