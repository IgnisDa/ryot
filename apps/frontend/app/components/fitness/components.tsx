import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Anchor,
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
import { useDisclosure } from "@mantine/hooks";
import {
	type ExerciseLot,
	SetLot,
	type UserUnitSystem,
	type WorkoutSupersetsInformation,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
import {
	IconArrowLeftToArc,
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
import type { ComponentType } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useExerciseDetails,
	useGetRandomMantineColor,
} from "~/lib/shared/hooks";
import { getExerciseDetailsPath, getSetColor } from "~/lib/shared/media-utils";
import {
	type TWorkoutDetails,
	getExerciseImages,
	getWorkoutDetailsQuery,
	getWorkoutTemplateDetailsQuery,
} from "~/lib/state/fitness";
import { FitnessEntity } from "~/lib/types";
import { ExerciseImagesList } from "./display-items";
import {
	DisplaySetStatistics,
	displayDistanceWithUnit,
	displayWeightWithUnit,
} from "./utils";

type Exercise = TWorkoutDetails["details"]["information"]["exercises"][number];
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
	hideExerciseDetails?: boolean;
	fitnessEntityType: FitnessEntity;
	hideExtraDetailsButton?: boolean;
	onCopyButtonClick?: () => Promise<void>;
	supersetInformation?: WorkoutSupersetsInformation[];
}) => {
	const theme = useMantineTheme();
	const [opened, { toggle }] = useDisclosure(false);
	const [parent] = useAutoAnimate();
	const { data: workoutDetails } = useQuery(
		// @ts-ignore: Too complicated to fix and it just works this way
		match(props.fitnessEntityType)
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
	const { data: exerciseDetails } = useExerciseDetails(exercise?.id);
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
							<ExerciseImagesList images={exercise.assets.s3Images} />
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
