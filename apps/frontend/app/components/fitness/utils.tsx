import { Text } from "@mantine/core";
import type { Slug } from "@mjcdev/react-body-highlighter";
import {
	ExerciseLot,
	ExerciseMuscle,
	UserUnitSystem,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";

export const getSetStatisticsTextToDisplay = (
	lot: ExerciseLot,
	statistic: WorkoutSetStatistic,
	unit: UserUnitSystem,
) => {
	return match(lot)
		.with(ExerciseLot.Reps, () => [`${statistic.reps} reps`, undefined])
		.with(ExerciseLot.RepsAndDuration, () => [
			`${statistic.reps} reps for ${Number(statistic.duration).toFixed(2)} min`,
			undefined,
		])
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
		.with(ExerciseLot.RepsAndWeight, () => [
			statistic.weight && statistic.weight !== "0"
				? `${displayWeightWithUnit(unit, statistic.weight)} × ${statistic.reps}`
				: `${statistic.reps} reps`,
			statistic.oneRm && statistic.oneRm !== "0"
				? `${Number(statistic.oneRm).toFixed(1)} RM`
				: null,
		])
		.with(ExerciseLot.RepsAndDurationAndDistance, () => [
			`${displayDistanceWithUnit(unit, statistic.distance)} × ${statistic.reps}`,
			`${Number(statistic.duration).toFixed(2)} min`,
		])
		.exhaustive();
};

export const displayWeightWithUnit = (
	unit: UserUnitSystem,
	data: string | number | null | undefined,
	compactNotation?: boolean,
) => {
	return new Intl.NumberFormat("en-us", {
		style: "unit",
		notation: compactNotation ? "compact" : undefined,
		unit: unit === UserUnitSystem.Metric ? "kilogram" : "pound",
	}).format(Number((data || 0).toString()));
};

export const displayDistanceWithUnit = (
	unit: UserUnitSystem,
	data: string | number | null | undefined,
	compactNotation?: boolean,
) => {
	return new Intl.NumberFormat("en-us", {
		style: "unit",
		notation: compactNotation ? "compact" : undefined,
		unit: unit === UserUnitSystem.Metric ? "kilometer" : "mile",
	}).format(Number((data || 0).toString()));
};

export const DisplaySetStatistics = (props: {
	lot: ExerciseLot;
	hideExtras?: boolean;
	centerText?: boolean;
	unitSystem: UserUnitSystem;
	statistic: WorkoutSetStatistic;
}) => {
	const [first, second] = getSetStatisticsTextToDisplay(
		props.lot,
		props.statistic,
		props.unitSystem,
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

export const mapMuscleToBodyPart = (muscle: ExerciseMuscle) => {
	const muscleMap: Record<ExerciseMuscle, Slug | null> = {
		[ExerciseMuscle.Lats]: null,
		[ExerciseMuscle.Neck]: "neck",
		[ExerciseMuscle.Chest]: "chest",
		[ExerciseMuscle.Abductors]: null,
		[ExerciseMuscle.Biceps]: "biceps",
		[ExerciseMuscle.Calves]: "calves",
		[ExerciseMuscle.Abdominals]: "abs",
		[ExerciseMuscle.Glutes]: "gluteal",
		[ExerciseMuscle.Traps]: "trapezius",
		[ExerciseMuscle.Triceps]: "triceps",
		[ExerciseMuscle.Forearms]: "forearm",
		[ExerciseMuscle.Shoulders]: "deltoids",
		[ExerciseMuscle.Adductors]: "adductors",
		[ExerciseMuscle.Hamstrings]: "hamstring",
		[ExerciseMuscle.LowerBack]: "lower-back",
		[ExerciseMuscle.MiddleBack]: "upper-back",
		[ExerciseMuscle.Quadriceps]: "quadriceps",
	};

	return muscleMap[muscle];
};
