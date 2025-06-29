import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Alert,
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
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure, useInViewport } from "@mantine/hooks";
import {
	ExerciseLot,
	SetLot,
	UserUnitSystem,
	type UserWorkoutDetailsQuery,
	type WorkoutSetStatistic,
	type WorkoutSupersetsInformation,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, isNumber, startCase } from "@ryot/ts-utils";
import {
	IconArrowLeftToArc,
	IconBellRinging,
	IconClock,
	IconInfoCircle,
	type IconProps,
	IconRoad,
	IconRotateClockwise,
	IconTrophy,
	IconWeight,
	IconZzz,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { BaseMediaDisplayItem } from "~/components/common";
import {
	FitnessEntity,
	dayjsLib,
	getExerciseDetailsPath,
	getSetColor,
} from "~/lib/common";
import { useGetRandomMantineColor, useUserDetails } from "~/lib/hooks";
import {
	getExerciseDetailsQuery,
	getExerciseImages,
	getUserExerciseDetailsQuery,
	getWorkoutDetailsQuery,
	getWorkoutTemplateDetailsQuery,
} from "~/lib/state/fitness";

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
		notation: compactNotation ? "compact" : undefined,
		unit: unit === UserUnitSystem.Metric ? "kilogram" : "pound",
	}).format(Number((data || 0).toString()));
};

/**
 * Display the correct distance unit for a given unit.
 */
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

/**
 * Display statistics for a set.
 **/
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

type Exercise =
	UserWorkoutDetailsQuery["userWorkoutDetails"]["details"]["information"]["exercises"][number];
type Set = Exercise["sets"][number];

export const DisplaySet = (props: {
	set: Set;
	idx: number;
	exerciseLot: ExerciseLot;
	unitSystem: UserUnitSystem;
}) => {
	const [opened, { close, open }] = useDisclosure(false);

	return (
		<Box key={`${props.idx}`} mb={2}>
			<Flex align="center">
				<Text
					fz="sm"
					mr="md"
					fw="bold"
					ff="monospace"
					c={getSetColor(props.set.lot)}
				>
					{match(props.set.lot)
						.with(SetLot.Normal, () => props.idx + 1)
						.otherwise(() => props.set.lot.at(0))}
				</Text>
				{props.set.personalBests && props.set.personalBests.length > 0 ? (
					<Popover position="left" withArrow shadow="md" opened={opened}>
						<Popover.Target>
							<ActionIcon
								color="grape"
								onMouseEnter={open}
								onMouseLeave={close}
								variant="transparent"
							>
								<IconTrophy size={18} />
							</ActionIcon>
						</Popover.Target>
						<Popover.Dropdown style={{ pointerEvents: "none" }} p={4}>
							<Flex>
								{props.set.personalBests.map((pb) => {
									const color = useGetRandomMantineColor(pb);
									return (
										<Badge key={pb} size="xs" color={color} variant="light">
											{startCase(pb)}
										</Badge>
									);
								})}
							</Flex>
						</Popover.Dropdown>
					</Popover>
				) : null}
				<DisplaySetStatistics
					lot={props.exerciseLot}
					unitSystem={props.unitSystem}
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
	entityType: FitnessEntity;
	hideExerciseDetails?: boolean;
	hideExtraDetailsButton?: boolean;
	onCopyButtonClick?: () => Promise<void>;
	supersetInformation?: WorkoutSupersetsInformation[];
}) => {
	const theme = useMantineTheme();
	const [opened, { toggle }] = useDisclosure(false);
	const [parent] = useAutoAnimate();
	const { data: workoutDetails } = useQuery(
		// @ts-ignore: Too complicated to fix and it just works this way
		match(props.entityType)
			.with(FitnessEntity.Workouts, () =>
				getWorkoutDetailsQuery(props.entityId),
			)
			.with(FitnessEntity.Templates, () =>
				getWorkoutTemplateDetailsQuery(props.entityId),
			)
			.exhaustive(),
	);
	const exercise =
		workoutDetails?.details.information.exercises[props.exerciseIdx];
	const { data: exerciseDetails } = useQuery(
		getExerciseDetailsQuery(exercise?.id || ""),
	);
	const isInSuperset = props.supersetInformation?.find((s) =>
		s.exercises.includes(props.exerciseIdx),
	);

	const images = getExerciseImages(exerciseDetails);
	const hasExtraDetailsToShow = Boolean(images.length > 0 || exercise?.total);

	return (
		<Paper
			p="xs"
			withBorder
			style={{
				borderLeftWidth: isInSuperset ? "3px" : undefined,
				borderLeftColor: isInSuperset
					? theme.colors[isInSuperset.color][6]
					: undefined,
			}}
		>
			{exerciseDetails && workoutDetails && exercise ? (
				<>
					<Stack
						gap="xs"
						ref={parent}
						mb={exercise.sets.length > 0 ? "xs" : undefined}
					>
						<Box>
							<Group justify="space-between" wrap="nowrap">
								<Anchor
									fw="bold"
									lineClamp={1}
									component={Link}
									style={{ scrollMargin: 20 }}
									to={
										props.hideExerciseDetails
											? $path("/fitness/:entity/:id", {
													entity: "workouts",
													id: props.entityId,
												})
											: getExerciseDetailsPath(exercise.id)
									}
								>
									{props.hideExerciseDetails
										? workoutDetails.details.name
										: exerciseDetails.name}
								</Anchor>
								{hasExtraDetailsToShow && !props.hideExtraDetailsButton ? (
									<ActionIcon onClick={toggle} variant="transparent">
										<IconInfoCircle size={18} />
									</ActionIcon>
								) : null}
								{props.onCopyButtonClick ? (
									<ActionIcon onClick={props.onCopyButtonClick} size="sm">
										<IconArrowLeftToArc size={16} />
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
									{exercise.total ? (
										<>
											<DisplayExerciseAttributes
												label="reps"
												icon={IconRotateClockwise}
												value={exercise.total.reps}
												quantity={exercise.total.reps}
											/>
											<DisplayExerciseAttributes
												label="duration"
												icon={IconClock}
												quantity={exercise.total.duration}
												value={`${exercise.total.duration} min`}
											/>
											<DisplayExerciseAttributes
												label="weight"
												icon={IconWeight}
												quantity={exercise.total.weight}
												value={displayWeightWithUnit(
													exercise.unitSystem,
													exercise.total.weight,
												)}
											/>
											<DisplayExerciseAttributes
												icon={IconRoad}
												label="distance"
												quantity={exercise.total.distance}
												value={displayDistanceWithUnit(
													exercise.unitSystem,
													exercise.total.distance,
												)}
											/>
											<DisplayExerciseAttributes
												icon={IconZzz}
												label="rest time"
												quantity={exercise.total.restTime}
												value={`${exercise.total.restTime}s`}
											/>
										</>
									) : null}
								</SimpleGrid>
								{!props.hideExerciseDetails ? (
									<ScrollArea type="scroll">
										<Flex gap="lg">
											{images.map((i) => (
												<Image key={i} radius="md" src={i} h={200} w={350} />
											))}
										</Flex>
									</ScrollArea>
								) : null}
							</>
						) : null}
						{exercise.notes.map((n, idxN) => (
							<Text c="dimmed" key={n} size="xs">
								{exercise.notes.length === 1 ? undefined : `${idxN + 1})`} {n}
							</Text>
						))}
						{exercise.assets && exercise.assets.s3Images.length > 0 ? (
							<Avatar.Group>
								{exercise.assets.s3Images.map((i) => (
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
							unitSystem={exercise.unitSystem}
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

const DisplayExerciseAttributes = (props: {
	label: string;
	value: number | string;
	quantity: number | string;
	icon: ComponentType<IconProps>;
}) => {
	return Number(props.quantity) > 0 ? (
		<Flex align="center" gap="xs">
			<props.icon size={14} />
			<Text fz="xs">
				{changeCase(props.label)}: {props.value}
			</Text>
		</Flex>
	) : null;
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
	const images = getExerciseImages(exerciseDetails);

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			imageUrl={images.at(0)}
			name={exerciseDetails?.name}
			isLoading={isExerciseDetailsLoading}
			onImageClickBehavior={[getExerciseDetailsPath(props.exerciseId)]}
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
			imageOverlay={{ topRight: props.topRight }}
			onImageClickBehavior={[
				$path("/fitness/:entity/:id", {
					entity: "workouts",
					id: props.workoutId,
				}),
			]}
			labels={{
				left: dayjsLib(workoutDetails?.details.startTime).format("l"),
				right: props.rightLabel,
			}}
		/>
	);
};

export const WorkoutTemplateDisplayItem = (props: {
	workoutTemplateId: string;
	topRight?: ReactNode;
}) => {
	const {
		data: workoutTemplateDetails,
		isLoading: isWorkoutTemplateDetailsLoading,
	} = useQuery(getWorkoutTemplateDetailsQuery(props.workoutTemplateId));

	return (
		<BaseMediaDisplayItem
			name={workoutTemplateDetails?.details.name}
			isLoading={isWorkoutTemplateDetailsLoading}
			imageOverlay={{ topRight: props.topRight }}
			onImageClickBehavior={[
				$path("/fitness/:entity/:id", {
					id: props.workoutTemplateId,
					entity: FitnessEntity.Templates,
				}),
			]}
			labels={{
				left: dayjsLib(workoutTemplateDetails?.details.createdOn).format("l"),
				right: "Template",
			}}
		/>
	);
};

export const WorkoutRevisionScheduledAlert = () => {
	const userDetails = useUserDetails();

	return userDetails.extraInformation?.scheduledForWorkoutRevision ? (
		<Alert icon={<IconBellRinging />}>
			A workout revision has been scheduled. Workout details might be outdated
			until revision is complete.
		</Alert>
	) : null;
};
