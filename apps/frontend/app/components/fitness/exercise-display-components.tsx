import { Anchor, Box, Flex, Group, Text } from "@mantine/core";
import { WorkoutSetPersonalBest } from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import { IconExternalLink } from "@tabler/icons-react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useUserUnitSystem, useUserWorkoutDetails } from "~/lib/shared/hooks";
import { displayDistanceWithUnit, displayWeightWithUnit } from "./utils";

export const DisplayData = (props: {
	name: string;
	data?: string | null;
	noCasing?: boolean;
}) => {
	return (
		<Box>
			<Text ta="center" c="dimmed" tt="capitalize" fz="xs">
				{startCase(props.name)}
			</Text>
			<Text ta="center" fz={{ base: "sm", md: "md" }}>
				{props.noCasing ? props.data : startCase(props.data?.toLowerCase())}
			</Text>
		</Box>
	);
};

export const DisplayLifetimeStatistic = (props: {
	val: string | number;
	stat: string;
}) => {
	return Number.parseFloat(props.val.toString()) !== 0 ? (
		<Flex mt={6} align="center" justify="space-between">
			<Text size="sm">Total {props.stat}</Text>
			<Text size="sm">{props.val}</Text>
		</Flex>
	) : null;
};

export const DisplayPersonalBest = (props: {
	set: { workoutId: string; exerciseIdx: number; setIdx: number };
	personalBestLot: WorkoutSetPersonalBest;
}) => {
	const unitSystem = useUserUnitSystem();
	const { data } = useUserWorkoutDetails(props.set.workoutId);
	const set =
		data?.details.information.exercises[props.set.exerciseIdx].sets[
			props.set.setIdx
		];
	if (!set) return null;

	return (
		<Group
			justify="space-between"
			key={`${props.set.workoutId}-${props.set.setIdx}`}
		>
			<Text size="sm">
				{match(props.personalBestLot)
					.with(WorkoutSetPersonalBest.OneRm, () =>
						Number(set.statistic.oneRm).toFixed(2),
					)
					.with(WorkoutSetPersonalBest.Reps, () => set.statistic.reps)
					.with(
						WorkoutSetPersonalBest.Time,
						() => `${set.statistic.duration} min`,
					)
					.with(WorkoutSetPersonalBest.Volume, () =>
						displayWeightWithUnit(unitSystem, set.statistic.volume),
					)
					.with(WorkoutSetPersonalBest.Weight, () =>
						displayWeightWithUnit(unitSystem, set.statistic.weight),
					)
					.with(WorkoutSetPersonalBest.Pace, () => `${set.statistic.pace}/min`)
					.with(WorkoutSetPersonalBest.Distance, () =>
						displayDistanceWithUnit(unitSystem, set.statistic.distance),
					)
					.exhaustive()}
			</Text>
			<Group>
				<Text size="sm">{dayjsLib(data.details.endTime).format("ll")}</Text>
				<Anchor
					component={Link}
					to={$path("/fitness/:entity/:id", {
						entity: "workouts",
						id: props.set.workoutId,
					})}
					fw="bold"
				>
					<IconExternalLink size={16} />
				</Anchor>
			</Group>
		</Group>
	);
};
