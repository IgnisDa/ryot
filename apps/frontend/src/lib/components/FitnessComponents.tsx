import { Badge, Group, Text, useMantineTheme } from "@mantine/core";
import {
	ExerciseLot,
	WorkoutSetPersonalBest,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import { IconTrophy } from "@tabler/icons-react";
import { match } from "ts-pattern";
import { getStringAsciiValue } from "../utilities";

export const getSetStatisticsTextToDisplay = (
	lot: ExerciseLot,
	statistic: WorkoutSetStatistic,
) => {
	return match(lot)
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${statistic.duration} km  × ${statistic.duration} min`,
			`${((statistic.distance || 1) / (statistic.duration || 1)).toFixed(
				2,
			)} km/min`,
		])
		.with(ExerciseLot.Duration, () => [`${statistic.duration} min`, undefined])
		.with(ExerciseLot.RepsAndWeight, () => [
			`${statistic.weight} kg  × ${statistic.reps}`,
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
							leftSection={<IconTrophy size="0.6rem" />}
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
