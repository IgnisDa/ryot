import { $path } from "@ignisda/remix-routes";
import { Anchor, Flex, Paper, Text } from "@mantine/core";
import { Link } from "@remix-run/react";
import {
	ExerciseLot,
	SetLot,
	type UserExerciseDetailsQuery,
	type UserUnitSystem,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
	truncate,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { withFragment } from "ufo";
import { dayjsLib, getSetColor } from "~/lib/generals";
import { useUserPreferences } from "~/lib/hooks";

export const getSetStatisticsTextToDisplay = (
	lot: ExerciseLot,
	statistic: WorkoutSetStatistic,
	unit: UserUnitSystem,
) => {
	return match(lot)
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${displayDistanceWithUnit(unit, statistic.distance)} for ${Number(
				statistic.duration,
			).toFixed(2)} min`,
			`${displayDistanceWithUnit(unit, statistic.pace)}/min`,
		])
		.with(ExerciseLot.Duration, () => [
			`${Number(statistic.duration).toFixed(2)} min`,
			undefined,
		])
		.with(ExerciseLot.Reps, () => [`${statistic.reps} reps`, undefined])
		.with(ExerciseLot.RepsAndWeight, () => [
			statistic.weight && statistic.weight !== "0"
				? `${displayWeightWithUnit(unit, statistic.weight)} × ${statistic.reps}`
				: `${statistic.reps} reps`,
			statistic.oneRm ? `${Number(statistic.oneRm).toFixed(1)} RM` : null,
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
	centerText?: boolean;
}) => {
	const userPreferences = useUserPreferences();
	const unitSystem = userPreferences.fitness.exercises.unitSystem;
	const [first, second] = getSetStatisticsTextToDisplay(
		props.lot,
		props.statistic,
		unitSystem,
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
			) : null}
		</>
	);
};

export const ExerciseHistory = (props: {
	exerciseId: string;
	exerciseLot: ExerciseLot;
	history: NonNullable<
		UserExerciseDetailsQuery["userExerciseDetails"]["history"]
	>[number];
}) => {
	return (
		<Paper key={props.history.workoutId} withBorder p="xs">
			<Anchor
				component={Link}
				to={withFragment(
					$path("/fitness/workouts/:id", { id: props.history.workoutId }),
					props.history.index.toString(),
				)}
				fw="bold"
			>
				{truncate(props.history.workoutName, { length: 36 })}
			</Anchor>
			<Text c="dimmed" fz="sm" mb="xs">
				{dayjsLib(props.history.workoutTime).format("LLLL")}
			</Text>
			{props.history.sets.map((s, idx) => (
				<Flex key={`${idx}-${s.lot}`} align="center">
					<Text fz="sm" c={getSetColor(s.lot)} mr="md" fw="bold" ff="monospace">
						{match(s.lot)
							.with(SetLot.Normal, () => idx + 1)
							.otherwise(() => s.lot.at(0))}
					</Text>
					<DisplayExerciseStats
						lot={props.exerciseLot}
						statistic={s.statistic}
					/>
				</Flex>
			))}
		</Paper>
	);
};
