import { Text } from "@mantine/core";
import {
	ExerciseLot,
	UserUnitSystem,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";
import type { ExerciseSetStats } from "~/lib/workout";

export const getSetStatisticsTextToDisplay = (
	lot: ExerciseLot,
	statistic: WorkoutSetStatistic | ExerciseSetStats,
	unit: UserUnitSystem,
) => {
	return match(lot)
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${Number(statistic.distance).toFixed(2)} ${
				unit === UserUnitSystem.Imperial ? "mi" : "km"
			} for ${Number(statistic.duration).toFixed(2)} min`,
			`${(
				(Number(statistic.distance) || 1) / (Number(statistic.duration) || 1)
			).toFixed(2)} ${unit === UserUnitSystem.Imperial ? "mi" : "km"}/min`,
		])
		.with(ExerciseLot.Duration, () => [
			`${Number(statistic.duration).toFixed(2)} min`,
			undefined,
		])
		.with(ExerciseLot.Reps, () => [`${statistic.reps} reps`, undefined])
		.with(ExerciseLot.RepsAndWeight, () => [
			statistic.weight && statistic.weight !== "0"
				? `${statistic.weight} ${
						unit === UserUnitSystem.Imperial ? "lb" : "kg"
				  }  × ${statistic.reps}`
				: `${statistic.reps} reps`,
			statistic.oneRm ? `${Number(statistic.oneRm).toFixed(1)} RM` : undefined,
		])
		.exhaustive();
};

/**
 * Display statistics for an exercise set.
 **/
export const DisplayExerciseStats = (props: {
	lot: ExerciseLot;
	statistic: ExerciseSetStats | WorkoutSetStatistic;
	unit: UserUnitSystem;
	hideExtras?: boolean;
	centerText?: boolean;
}) => {
	const [first, second] = getSetStatisticsTextToDisplay(
		props.lot,
		props.statistic,
		props.unit,
	);
	return (
		<>
			<Text
				fz={props.hideExtras ? "xs" : "sm"}
				ta={props.centerText ? "center" : undefined}
			>
				{first}
			</Text>
			{!props.hideExtras && second ? (
				<Text
					ml="auto"
					fz={props.hideExtras ? "xs" : "sm"}
					ta={props.centerText ? "center" : undefined}
				>
					{second}
				</Text>
			) : undefined}
		</>
	);
};
