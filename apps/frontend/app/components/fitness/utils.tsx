import { Text } from "@mantine/core";
import type { Slug } from "@mjcdev/react-body-highlighter";
import {
	ExerciseDurationUnit,
	ExerciseLot,
	ExerciseMuscle,
	UserUnitSystem,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";

export const convertDurationFromMinutes = (
	minutes: number | string | null | undefined,
	targetUnit: ExerciseDurationUnit,
) => {
	const mins = Number(minutes || 0);
	return targetUnit === ExerciseDurationUnit.Seconds ? mins * 60 : mins;
};

export const convertDurationToMinutes = (
	value: number | string | null | undefined,
	sourceUnit: ExerciseDurationUnit,
) => {
	const val = Number(value || 0);
	return sourceUnit === ExerciseDurationUnit.Seconds ? val / 60 : val;
};

export const getDurationUnitLabel = (
	unit: ExerciseDurationUnit,
	format: "long" | "short" = "long",
) => {
	if (format === "short") {
		return unit === ExerciseDurationUnit.Seconds ? "s" : "min";
	}
	return unit === ExerciseDurationUnit.Seconds ? "SEC" : "MIN";
};

export const formatDuration = (
	minutes: number | string | null | undefined,
	targetUnit: ExerciseDurationUnit,
) => {
	const converted = convertDurationFromMinutes(minutes, targetUnit);
	return targetUnit === ExerciseDurationUnit.Seconds
		? Math.round(converted).toString()
		: converted.toFixed(2);
};

export const getSetStatisticsTextToDisplay = (
	lot: ExerciseLot,
	statistic: WorkoutSetStatistic,
	unit: UserUnitSystem,
	durationUnit: ExerciseDurationUnit = ExerciseDurationUnit.Minutes,
) => {
	const durationLabel = getDurationUnitLabel(durationUnit, "short");
	return match(lot)
		.with(ExerciseLot.Reps, () => [`${statistic.reps} reps`, undefined])
		.with(ExerciseLot.RepsAndDuration, () => [
			`${statistic.reps} reps for ${formatDuration(statistic.duration, durationUnit)} ${durationLabel}`,
			undefined,
		])
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${displayDistanceWithUnit(unit, statistic.distance)} for ${formatDuration(statistic.duration, durationUnit)} ${durationLabel}`,
			`${displayDistanceWithUnit(unit, statistic.pace)}/min`,
		])
		.with(ExerciseLot.Duration, () => [
			`${formatDuration(statistic.duration, durationUnit)} ${durationLabel}`,
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
			`${formatDuration(statistic.duration, durationUnit)} ${durationLabel}`,
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
	durationUnit: ExerciseDurationUnit;
}) => {
	const [first, second] = getSetStatisticsTextToDisplay(
		props.lot,
		props.statistic,
		props.unitSystem,
		props.durationUnit,
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
		[ExerciseMuscle.Neck]: "neck",
		[ExerciseMuscle.Chest]: "chest",
		[ExerciseMuscle.Abductors]: null,
		[ExerciseMuscle.Biceps]: "biceps",
		[ExerciseMuscle.Calves]: "calves",
		[ExerciseMuscle.Abdominals]: "abs",
		[ExerciseMuscle.Glutes]: "gluteal",
		[ExerciseMuscle.Traps]: "trapezius",
		[ExerciseMuscle.Triceps]: "triceps",
		[ExerciseMuscle.Lats]: "upper-back",
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
