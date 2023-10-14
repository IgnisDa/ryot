import { Badge, Group, Text, useMantineTheme } from "@mantine/core";
import {
	ExerciseLot,
	WorkoutSetPersonalBest,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import { IconTrophy } from "@tabler/icons-react";
import { match } from "ts-pattern";
import type { ExerciseSetStats } from "../state";
import { getStringAsciiValue } from "../utilities";

export const getSetStatisticsTextToDisplay = (
	lot: ExerciseLot,
	statistic: WorkoutSetStatistic | ExerciseSetStats,
) => {
	return match(lot)
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${Number(statistic.duration).toFixed(2)} km  × ${Number(
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
			`${((Number(statistic.weight) || 1) * (statistic.reps || 1)).toFixed(
				2,
			)} vol`,
		])
		.exhaustive();
};

/**
 * Display statistics for an exercise set.
 **/
export const DisplayExerciseStats = (props: {
	lot: ExerciseLot;
	statistic: ExerciseSetStats | WorkoutSetStatistic;
	personalBests?: WorkoutSetPersonalBest[];
	hideExtras?: boolean;
}) => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	const [first, second] = getSetStatisticsTextToDisplay(
		props.lot,
		props.statistic,
	);
	return (
		<>
			<Text fz={props.hideExtras ? "xs" : "sm"}>{first}</Text>
			{props.personalBests ? (
				<Group gap="xs" ml="xs">
					{props.personalBests.map((pb) => (
						<Badge
							variant="light"
							size="xs"
							leftSection={<IconTrophy size={16} />}
							color={
								colors[
									(getStringAsciiValue(pb) + colors.length) % colors.length
								]
							}
						>
							{startCase(pb)}
						</Badge>
					))}
				</Group>
			) : undefined}
			{!props.hideExtras && second ? (
				<Text ml="auto" fz={props.hideExtras ? "xs" : "sm"}>
					{second}
				</Text>
			) : undefined}
		</>
	);
};
