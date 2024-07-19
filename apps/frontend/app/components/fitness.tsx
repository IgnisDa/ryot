import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Badge,
	Box,
	Flex,
	Paper,
	Popover,
	Skeleton,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link } from "@remix-run/react";
import {
	ExerciseLot,
	SetLot,
	type UserExerciseDetailsQuery,
	UserUnitSystem,
	type WorkoutDetailsQuery,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { startCase, truncate } from "@ryot/ts-utils";
import { IconTrophy } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { match } from "ts-pattern";
import { withFragment } from "ufo";
import { dayjsLib, getSetColor } from "~/lib/generals";
import { useGetMantineColor, useUserUnitSystem } from "~/lib/hooks";
import { getWorkoutDetailsQuery } from "~/lib/state/fitness";

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
 * Display the correct weight unit for a given unit.
 */
export const displayWeightWithUnit = (
	unit: UserUnitSystem,
	data: string | number | null | undefined,
	compactNotation?: boolean,
) => {
	return new Intl.NumberFormat("en-us", {
		style: "unit",
		unit: unit === UserUnitSystem.Metric ? "kilogram" : "pound",
		notation: compactNotation ? "compact" : undefined,
	}).format(Number((data || 0).toString()));
};

/**
 * Display the correct distance unit for a given unit.
 */
export const displayDistanceWithUnit = (
	unit: UserUnitSystem,
	data: string | number | null | undefined,
) => {
	return new Intl.NumberFormat("en-us", {
		style: "unit",
		unit: unit === UserUnitSystem.Metric ? "kilometer" : "mile",
	}).format(Number((data || 0).toString()));
};

/**
 * Display statistics for a set.
 **/
export const DisplaySetStatistics = (props: {
	lot: ExerciseLot;
	statistic: WorkoutSetStatistic;
	hideExtras?: boolean;
	centerText?: boolean;
}) => {
	const unitSystem = useUserUnitSystem();
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

type Exercise =
	WorkoutDetailsQuery["workoutDetails"]["information"]["exercises"][number];
type Set = Exercise["sets"][number];

export const DisplaySet = (props: {
	set: Set;
	idx: number;
	exerciseLot: ExerciseLot;
}) => {
	const getMantineColor = useGetMantineColor();
	const [opened, { close, open }] = useDisclosure(false);

	return (
		<Box key={`${props.idx}`} mb={2}>
			<Flex align="center">
				<Text
					fz="sm"
					c={getSetColor(props.set.lot)}
					mr="md"
					fw="bold"
					ff="monospace"
				>
					{match(props.set.lot)
						.with(SetLot.Normal, () => props.idx + 1)
						.otherwise(() => props.set.lot.at(0))}
				</Text>
				{props.set.personalBests && props.set.personalBests.length > 0 ? (
					<Popover position="left" withArrow shadow="md" opened={opened}>
						<Popover.Target>
							<ActionIcon
								onMouseEnter={open}
								onMouseLeave={close}
								variant="transparent"
								color="grape"
							>
								<IconTrophy size={18} />
							</ActionIcon>
						</Popover.Target>
						<Popover.Dropdown style={{ pointerEvents: "none" }} p={4}>
							<Flex>
								{props.set.personalBests.map((pb) => (
									<Badge
										key={pb}
										variant="light"
										size="xs"
										color={getMantineColor(pb)}
									>
										{startCase(pb)}
									</Badge>
								))}
							</Flex>
						</Popover.Dropdown>
					</Popover>
				) : null}
				<DisplaySetStatistics
					lot={props.exerciseLot}
					statistic={props.set.statistic}
				/>
			</Flex>
			{props.set.note ? (
				<Text c="dimmed" size="xs">
					{props.set.note}
				</Text>
			) : null}
		</Box>
	);
};

export const ExerciseHistory = (props: {
	exerciseId: string;
	exerciseLot: ExerciseLot;
	history: NonNullable<
		UserExerciseDetailsQuery["userExerciseDetails"]["history"]
	>[number];
}) => {
	const { data: workoutData } = useQuery(
		getWorkoutDetailsQuery(props.history.workoutId),
	);

	return (
		<Paper key={props.history.workoutId} withBorder p="xs">
			{workoutData ? (
				<>
					<Anchor
						component={Link}
						to={withFragment(
							$path("/fitness/workouts/:id", { id: props.history.workoutId }),
							props.history.idx.toString(),
						)}
						fw="bold"
					>
						{truncate(workoutData.name, { length: 36 })}
					</Anchor>
					<Text c="dimmed" fz="sm" mb="xs">
						{dayjsLib(workoutData.endTime).format("LLLL")}
					</Text>
					{workoutData.information.exercises[props.history.idx].sets.map(
						(set, idx) => (
							<DisplaySet
								idx={idx}
								set={set}
								key={`${idx}-${set.lot}`}
								exerciseLot={props.exerciseLot}
							/>
						),
					)}
				</>
			) : (
				<Skeleton h={20} />
			)}
		</Paper>
	);
};
