import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Badge,
	Box,
	Flex,
	Group,
	Image,
	Paper,
	Popover,
	ScrollArea,
	SimpleGrid,
	Skeleton,
	Stack,
	Text,
} from "@mantine/core";
import { useDisclosure, useInViewport } from "@mantine/hooks";
import { Link } from "@remix-run/react";
import {
	ExerciseLot,
	SetLot,
	UserUnitSystem,
	type WorkoutDetailsQuery,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, startCase } from "@ryot/ts-utils";
import {
	IconClock,
	IconInfoCircle,
	IconRotateClockwise,
	IconRun,
	IconTrophy,
	IconWeight,
	IconZzz,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { withFragment } from "ufo";
import { dayjsLib, getSetColor } from "~/lib/generals";
import { useGetMantineColor, useUserUnitSystem } from "~/lib/hooks";
import {
	getExerciseDetailsQuery,
	getUserExerciseDetailsQuery,
	getWorkoutDetailsQuery,
} from "~/lib/state/fitness";
import { BaseMediaDisplayItem } from "./media";

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
	WorkoutDetailsQuery["workoutDetails"]["details"]["information"]["exercises"][number];
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
	entityId: string;
	exerciseIdx: number;
	hideExerciseDetails?: boolean;
	hideExtraDetailsButton?: boolean;
}) => {
	const unitSystem = useUserUnitSystem();
	const [opened, { toggle }] = useDisclosure(false);
	const [parent] = useAutoAnimate();
	const { data: workoutDetails } = useQuery(
		getWorkoutDetailsQuery(props.entityId),
	);
	const exercise =
		workoutDetails?.details.information.exercises[props.exerciseIdx];
	const { data: exerciseDetails } = useQuery(
		getExerciseDetailsQuery(exercise?.name || ""),
	);

	const supersetLinks =
		exercise && exercise.supersetWith.length > 0
			? exercise.supersetWith
					.map<ReactNode>((otherExerciseIdx) => (
						<Anchor
							key={otherExerciseIdx}
							fz="xs"
							href={withFragment(
								$path("/fitness/:entity/:id", {
									entity: "workouts",
									id: props.entityId,
								}),
								otherExerciseIdx.toString(),
							)}
						>
							{
								workoutDetails.details.information.exercises[otherExerciseIdx]
									.name
							}
						</Anchor>
					))
					.reduce((prev, curr) => [prev, ", ", curr])
			: null;

	return (
		<Paper withBorder p="xs" id={props.exerciseIdx.toString()}>
			{exerciseDetails && workoutDetails && exercise ? (
				<>
					<Stack mb="xs" gap="xs" ref={parent}>
						<Box>
							<Group justify="space-between" wrap="nowrap">
								<Anchor
									component={Link}
									to={
										props.hideExerciseDetails
											? withFragment(
													$path("/fitness/:entity/:id", {
														entity: "workouts",
														id: props.entityId,
													}),
													props.exerciseIdx.toString(),
												)
											: $path("/fitness/exercises/item/:id", {
													id: encodeURIComponent(exercise.name),
												})
									}
									fw="bold"
									lineClamp={1}
									style={{ scrollMargin: 20 }}
								>
									{props.hideExerciseDetails
										? workoutDetails.details.name
										: exercise.name}
								</Anchor>
								{!props.hideExtraDetailsButton ? (
									<ActionIcon onClick={toggle} variant="transparent">
										<IconInfoCircle size={18} />
									</ActionIcon>
								) : null}
							</Group>
							{props.hideExerciseDetails ? (
								<Text c="dimmed" fz="sm">
									{dayjsLib(workoutDetails.details.endTime).format("LLLL")}
								</Text>
							) : null}
						</Box>
						{opened ? (
							<>
								<SimpleGrid cols={{ base: 2, md: 3 }} spacing={4}>
									{exercise.restTime ? (
										<Flex align="center" gap="xs">
											<IconZzz size={14} />
											<Text fz="xs">Rest time: {exercise.restTime}s</Text>
										</Flex>
									) : null}
									{exercise.total ? (
										<>
											{Number(exercise.total.reps) > 0 ? (
												<Flex align="center" gap="xs">
													<IconRotateClockwise size={14} />
													<Text fz="xs">Reps: {exercise.total.reps}</Text>
												</Flex>
											) : null}
											{Number(exercise.total.duration) > 0 ? (
												<Flex align="center" gap="xs">
													<IconClock size={14} />
													<Text fz="xs">
														Duration: {exercise.total.duration} min
													</Text>
												</Flex>
											) : null}
											{Number(exercise.total.weight) > 0 ? (
												<Flex align="center" gap="xs">
													<IconWeight size={14} />
													<Text fz="xs">
														Weight:{" "}
														{displayWeightWithUnit(
															unitSystem,
															exercise.total.weight,
														)}
													</Text>
												</Flex>
											) : null}
											{Number(exercise.total.distance) > 0 ? (
												<Flex align="center" gap="xs">
													<IconRun size={14} />
													<Text fz="xs">
														Distance:{" "}
														{displayDistanceWithUnit(
															unitSystem,
															exercise.total.distance,
														)}
													</Text>
												</Flex>
											) : null}
										</>
									) : null}
								</SimpleGrid>
								{!props.hideExerciseDetails && exerciseDetails ? (
									<ScrollArea type="scroll">
										<Flex gap="lg">
											{exerciseDetails.attributes.images.map((i) => (
												<Image key={i} radius="md" src={i} h={200} w={350} />
											))}
										</Flex>
									</ScrollArea>
								) : null}
							</>
						) : null}
						{!props.hideExerciseDetails && supersetLinks ? (
							<Text fz="xs">Superset with {supersetLinks}</Text>
						) : null}
						{exercise.notes.map((n, idxN) => (
							<Text c="dimmed" key={n} size="xs">
								{exercise.notes.length === 1 ? undefined : `${idxN + 1})`} {n}
							</Text>
						))}
						{exercise.assets && exercise.assets.images.length > 0 ? (
							<Avatar.Group>
								{exercise.assets.images.map((i) => (
									<Anchor key={i} href={i} target="_blank">
										<Avatar src={i} />
									</Anchor>
								))}
							</Avatar.Group>
						) : null}
					</Stack>
					{exercise.sets.map((set, idx) => (
						<DisplaySet
							set={set}
							idx={idx}
							exerciseLot={exercise.lot}
							key={`${set.confirmedAt}-${idx}`}
						/>
					))}
				</>
			) : (
				<Skeleton h={20} />
			)}
		</Paper>
	);
};

export const ExerciseDisplayItem = (props: {
	exerciseId: string;
	topRight?: ReactNode;
	rightLabel?: ReactNode;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: exerciseDetails, isLoading: isExerciseDetailsLoading } =
		useQuery({
			...getExerciseDetailsQuery(props.exerciseId),
			enabled: inViewport,
		});
	const { data: userExerciseDetails } = useQuery({
		...getUserExerciseDetailsQuery(props.exerciseId),
		enabled: inViewport,
	});
	const times = userExerciseDetails?.details?.exerciseNumTimesInteracted;

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			name={exerciseDetails?.id}
			isLoading={isExerciseDetailsLoading}
			onImageClickBehavior={$path("/fitness/exercises/item/:id", {
				id: encodeURIComponent(props.exerciseId),
			})}
			imageUrl={exerciseDetails?.attributes.images.at(0)}
			labels={{
				left: isNumber(times)
					? `${times} time${times > 1 ? "s" : ""}`
					: undefined,
				right: props.rightLabel,
			}}
			imageOverlay={{ topRight: props.topRight }}
		/>
	);
};

export const WorkoutDisplayItem = (props: {
	workoutId: string;
	rightLabel?: ReactNode;
	topRight?: ReactNode;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: workoutDetails, isLoading: isWorkoutDetailsLoading } = useQuery(
		{ ...getWorkoutDetailsQuery(props.workoutId), enabled: inViewport },
	);

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			name={workoutDetails?.details.name}
			isLoading={isWorkoutDetailsLoading}
			onImageClickBehavior={$path("/fitness/:entity/:id", {
				id: props.workoutId,
				entity: "workouts",
			})}
			labels={{
				left: dayjsLib(workoutDetails?.details.startTime).format("l"),
				right: props.rightLabel,
			}}
			imageOverlay={{ topRight: props.topRight }}
		/>
	);
};
