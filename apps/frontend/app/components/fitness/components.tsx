import { useAutoAnimate } from "@formkit/auto-animate/react";
import { LineChart } from "@mantine/charts";
import {
	ActionIcon,
	Anchor,
	Badge,
	Box,
	Button,
	Center,
	Divider,
	Flex,
	Group,
	Image,
	List,
	Modal,
	NumberInput,
	Paper,
	Popover,
	ScrollArea,
	Select,
	SimpleGrid,
	Skeleton,
	Stack,
	Switch,
	Text,
	Title,
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import Body, { type ExtendedBodyPart } from "@mjcdev/react-body-highlighter";
import {
	EntityLot,
	type ExerciseLot,
	SetLot,
	type UserUnitSystem,
	WorkoutSetPersonalBest,
	type WorkoutSupersetsInformation,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	isNumber,
	snakeCase,
	sortBy,
	startCase,
} from "@ryot/ts-utils";
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
import { type UseMutationResult, useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import {
	type ComponentType,
	type Dispatch,
	Fragment,
	type SetStateAction,
} from "react";
import { Link, type NavigateFunction } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { DisplayCollectionToEntity } from "~/components/common";
import { ReviewItemDisplay } from "~/components/common/review";
import { MediaScrollArea } from "~/components/media/base-display";
import { dayjsLib, getDateFromTimeSpan } from "~/lib/shared/date-utils";
import {
	useExerciseDetails,
	useGetRandomMantineColor,
	useS3PresignedUrls,
} from "~/lib/shared/hooks";
import { getExerciseDetailsPath, getSetColor } from "~/lib/shared/media-utils";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import {
	type TWorkoutDetails,
	getWorkoutDetailsQuery,
	getWorkoutTemplateDetailsQuery,
	useExerciseImages,
} from "~/lib/state/fitness";
import { FitnessEntity, TimeSpan } from "~/lib/types";
import { ExerciseImagesList } from "./display-items";
import {
	DisplayData,
	DisplayLifetimeStatistic,
	DisplayPersonalBest,
} from "./exercise-display-components";
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
		// @ts-expect-error: Too complicated to fix and it just works this way
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
	const { data: exerciseDetails } = useExerciseDetails(
		exercise?.id,
		!!exercise?.id,
	);
	const isInSuperset = props.supersetInformation?.find((s) =>
		s.exercises.includes(props.exerciseIdx),
	);

	const exerciseS3ImagesPresigned = useS3PresignedUrls(
		exercise?.assets?.s3Images,
	);
	const exerciseImages = [
		...(exercise?.assets?.remoteImages || []),
		...(exerciseS3ImagesPresigned.data || []),
	];

	const images = useExerciseImages(exerciseDetails);
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
						{exerciseImages.length > 0 ? (
							<ExerciseImagesList images={exerciseImages} />
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

export const ExerciseUpdatePreferencesModal = (props: {
	opened: boolean;
	onClose: () => void;
	userExerciseDetails: {
		details?: {
			exerciseExtraInformation?: {
				settings: {
					excludeFromAnalytics?: boolean;
					setRestTimers: Record<string, number | null>;
				};
			} | null;
		} | null;
	};
	changingExerciseSettings: {
		isChanged: boolean;
		value: {
			excludeFromAnalytics: boolean;
			setRestTimers: Record<string, number | null>;
		};
	};
	setChangingExerciseSettings: Dispatch<
		SetStateAction<{
			isChanged: boolean;
			value: {
				excludeFromAnalytics: boolean;
				setRestTimers: Record<string, number | null>;
			};
		}>
	>;
	updateUserExerciseSettingsMutation: UseMutationResult<
		void,
		Error,
		void,
		unknown
	>;
}) => {
	return (
		<Modal
			centered
			withCloseButton={false}
			opened={props.opened}
			onClose={props.onClose}
		>
			<Stack>
				<Switch
					label="Exclude from analytics"
					defaultChecked={
						props.userExerciseDetails.details?.exerciseExtraInformation
							?.settings.excludeFromAnalytics
					}
					onChange={(ev) => {
						props.setChangingExerciseSettings(
							produce(props.changingExerciseSettings, (draft) => {
								draft.isChanged = true;
								draft.value.excludeFromAnalytics = ev.currentTarget.checked;
							}),
						);
					}}
				/>
				<Text size="sm">
					When a new set is added, rest timers will be added automatically
					according to the settings below.
					<Text size="xs" c="dimmed" span>
						{" "}
						Default rest timer durations for all exercises can be changed in the
						fitness preferences.
					</Text>
				</Text>
				<SimpleGrid cols={2}>
					{(["normal", "warmup", "drop", "failure"] as const).map((name) => {
						const value =
							props.userExerciseDetails.details?.exerciseExtraInformation
								?.settings.setRestTimers[name];
						return (
							<NumberInput
								suffix="s"
								key={name}
								label={changeCase(snakeCase(name))}
								defaultValue={isNumber(value) ? value : undefined}
								onChange={(val) => {
									if (isNumber(val))
										props.setChangingExerciseSettings(
											produce(props.changingExerciseSettings, (draft) => {
												draft.isChanged = true;
												draft.value.setRestTimers[name] = val;
											}),
										);
								}}
							/>
						);
					})}
				</SimpleGrid>
				<Button
					type="submit"
					disabled={!props.changingExerciseSettings.isChanged}
					loading={props.updateUserExerciseSettingsMutation.isPending}
					onClick={async () => {
						await props.updateUserExerciseSettingsMutation.mutateAsync();
						notifications.show({
							color: "green",
							title: "Settings updated",
							message: "Settings for the exercise have been updated.",
						});
						props.onClose();
					}}
				>
					Save settings
				</Button>
			</Stack>
		</Modal>
	);
};

export const ExerciseMusclesModal = (props: {
	opened: boolean;
	onClose: () => void;
	bodyViewSide: "front" | "back";
	setBodyViewSide: Dispatch<SetStateAction<"front" | "back">>;
	bodyViewGender: "male" | "female";
	setBodyViewGender: Dispatch<SetStateAction<"male" | "female">>;
	bodyPartsData: ExtendedBodyPart[];
}) => {
	return (
		<Modal
			centered
			size="lg"
			title="Muscles"
			opened={props.opened}
			onClose={props.onClose}
		>
			<Stack>
				<Group justify="center" gap="lg">
					<Group gap="xs">
						<Text size="sm">Side:</Text>
						<Button.Group>
							<Button
								size="xs"
								onClick={() => props.setBodyViewSide("front")}
								variant={props.bodyViewSide === "front" ? "filled" : "outline"}
							>
								Front
							</Button>
							<Button
								size="xs"
								onClick={() => props.setBodyViewSide("back")}
								variant={props.bodyViewSide === "back" ? "filled" : "outline"}
							>
								Back
							</Button>
						</Button.Group>
					</Group>
					<Group gap="xs">
						<Text size="sm">Gender:</Text>
						<Button.Group>
							<Button
								size="xs"
								onClick={() => props.setBodyViewGender("male")}
								variant={props.bodyViewGender === "male" ? "filled" : "outline"}
							>
								Male
							</Button>
							<Button
								size="xs"
								onClick={() => props.setBodyViewGender("female")}
								variant={
									props.bodyViewGender === "female" ? "filled" : "outline"
								}
							>
								Female
							</Button>
						</Button.Group>
					</Group>
				</Group>
				<Center>
					<Body
						side={props.bodyViewSide}
						data={props.bodyPartsData}
						gender={props.bodyViewGender}
					/>
				</Center>
			</Stack>
		</Modal>
	);
};

export const ExerciseOverviewTab = (props: {
	images: string[];
	exerciseDetails: {
		id: string;
		name: string;
		level?: string | null;
		force?: string | null;
		mechanic?: string | null;
		equipment?: string | null;
		lot?: string | null;
		muscles: string[];
		instructions: string[];
	};
	exerciseNumTimesInteracted: number;
	userExerciseDetails: {
		history?: Array<{ workoutId: string }> | null;
		details?: {
			createdOn?: string | null;
			lastUpdatedOn?: string | null;
		} | null;
	};
	openMusclesModal: () => void;
}) => {
	return (
		<Stack>
			<ScrollArea>
				<Flex gap={6}>
					{props.images.map((i) => (
						<Image key={i} radius="md" src={i} h="200px" w="248px" />
					))}
				</Flex>
			</ScrollArea>
			<SimpleGrid py="xs" cols={4}>
				{(["level", "force", "mechanic", "equipment"] as const).map((f) => (
					<Fragment key={f}>
						{props.exerciseDetails[f] ? (
							<DisplayData name={f} data={props.exerciseDetails[f]} />
						) : null}
					</Fragment>
				))}
				{props.exerciseDetails.lot ? (
					<DisplayData
						name="Type"
						data={changeCase(props.exerciseDetails.lot)}
					/>
				) : null}
				{props.exerciseNumTimesInteracted > 0 ? (
					<DisplayData
						noCasing
						name="Times done"
						data={`${props.exerciseNumTimesInteracted} times`}
					/>
				) : null}
				{(props.userExerciseDetails.history?.length || 0) > 0 ? (
					<>
						{props.userExerciseDetails.details?.createdOn ? (
							<DisplayData
								noCasing
								name="First done on"
								data={dayjsLib(
									props.userExerciseDetails.details.createdOn,
								).format("ll")}
							/>
						) : null}
						{props.userExerciseDetails.details?.lastUpdatedOn ? (
							<DisplayData
								noCasing
								name="Last done on"
								data={dayjsLib(
									props.userExerciseDetails.details.lastUpdatedOn,
								).format("ll")}
							/>
						) : null}
					</>
				) : null}
			</SimpleGrid>
			{props.exerciseDetails.muscles.length > 0 ? (
				<>
					<Divider />
					<Group wrap="nowrap">
						<Anchor fz="sm" onClick={props.openMusclesModal}>
							Muscles
						</Anchor>
						<Text fz="sm">
							{props.exerciseDetails.muscles
								.map((s) => startCase(s.toLowerCase()))
								.join(", ")}
						</Text>
					</Group>
				</>
			) : null}
			{props.exerciseDetails.instructions.length > 0 ? (
				<>
					<Divider />
					<Text size="xl" fw="bold">
						Instructions
					</Text>
					<List type="ordered" spacing="xs">
						{props.exerciseDetails.instructions.map((d) => (
							<List.Item key={d}>{d}</List.Item>
						))}
					</List>
				</>
			) : null}
		</Stack>
	);
};

export const ExerciseRecordsTab = (props: {
	unitSystem: UserUnitSystem;
	exerciseNumTimesInteracted: number;
	userExerciseDetails: {
		details?: {
			exerciseExtraInformation?: {
				lifetimeStats: {
					weight: string;
					distance: string;
					duration: string;
					reps: string;
				};
				personalBests: Array<{
					lot: WorkoutSetPersonalBest;
					sets: Array<{
						workoutId: string;
						exerciseIdx: number;
						setIdx: number;
					}>;
				}>;
			};
		} | null;
	};
}) => {
	return (
		<Stack gap="xl">
			<Stack gap="xs">
				<Text size="lg" td="underline">
					Lifetime Stats
				</Text>
				<Box>
					<DisplayLifetimeStatistic
						stat="weight"
						val={displayWeightWithUnit(
							props.unitSystem,
							props.userExerciseDetails.details?.exerciseExtraInformation
								?.lifetimeStats.weight,
						)}
					/>
					<DisplayLifetimeStatistic
						stat="distance"
						val={displayDistanceWithUnit(
							props.unitSystem,
							props.userExerciseDetails.details?.exerciseExtraInformation
								?.lifetimeStats.distance,
						)}
					/>
					<DisplayLifetimeStatistic
						stat="duration"
						val={`${props.userExerciseDetails.details?.exerciseExtraInformation?.lifetimeStats.duration} MIN`}
					/>
					<DisplayLifetimeStatistic
						stat="reps"
						val={
							props.userExerciseDetails.details?.exerciseExtraInformation
								?.lifetimeStats.reps || "0"
						}
					/>
					<DisplayLifetimeStatistic
						stat="times done"
						val={props.exerciseNumTimesInteracted}
					/>
				</Box>
			</Stack>
			{(props.userExerciseDetails.details?.exerciseExtraInformation
				?.personalBests.length || 0) > 0 ? (
				<Stack gap="sm">
					<Text size="lg" td="underline">
						Personal Bests
					</Text>
					{props.userExerciseDetails.details?.exerciseExtraInformation?.personalBests.map(
						(personalBest) => (
							<Box key={personalBest.lot}>
								<Text size="sm" c="dimmed">
									{changeCase(personalBest.lot)}
								</Text>
								{personalBest.sets.map((pbSet) => (
									<DisplayPersonalBest
										set={pbSet}
										key={pbSet.workoutId}
										personalBestLot={personalBest.lot}
									/>
								))}
							</Box>
						),
					)}
				</Stack>
			) : null}
		</Stack>
	);
};

export const ExerciseChartsTab = (props: {
	timeSpanForCharts: TimeSpan;
	setTimeSpanForCharts: Dispatch<SetStateAction<TimeSpan>>;
	bestMappings: WorkoutSetPersonalBest[];
	filteredHistoryForCharts: Array<{
		workoutEndOn: string;
		bestSet?: {
			statistic: {
				oneRm?: string;
				pace?: string;
				reps?: string;
				duration?: string;
				volume?: string;
				weight?: string;
				distance?: string;
			};
		} | null;
	}>;
}) => {
	return (
		<Stack>
			<Select
				label="Time span"
				labelProps={{ c: "dimmed" }}
				defaultValue={props.timeSpanForCharts}
				data={convertEnumToSelectData(TimeSpan)}
				onChange={(v) => {
					if (v) props.setTimeSpanForCharts(v as TimeSpan);
				}}
			/>
			{props.bestMappings.map((best) => {
				const data = props.filteredHistoryForCharts.map((h) => {
					const stat = h.bestSet?.statistic;
					const value = match(best)
						.with(WorkoutSetPersonalBest.OneRm, () => stat?.oneRm)
						.with(WorkoutSetPersonalBest.Pace, () => stat?.pace)
						.with(WorkoutSetPersonalBest.Reps, () => stat?.reps)
						.with(WorkoutSetPersonalBest.Time, () => stat?.duration)
						.with(WorkoutSetPersonalBest.Volume, () => stat?.volume)
						.with(WorkoutSetPersonalBest.Weight, () => stat?.weight)
						.with(WorkoutSetPersonalBest.Distance, () => stat?.distance)
						.exhaustive();
					return {
						name: dayjsLib(h.workoutEndOn).format("DD/MM/YYYY"),
						value: value ? Number.parseFloat(value) : null,
					};
				});
				invariant(data);
				return data.filter((d) => d.value).length > 0 ? (
					<Paper key={best} withBorder py="md" radius="md">
						<Stack>
							<Title order={3} ta="center">
								{changeCase(best)}
							</Title>
							<LineChart
								h={300}
								ml={-15}
								data={data}
								connectNulls
								dataKey="name"
								series={[{ name: "value", label: changeCase(best) }]}
							/>
						</Stack>
					</Paper>
				) : null;
			})}
		</Stack>
	);
};

export const ExerciseActionsTab = (props: {
	openUpdatePreferencesModal: () => void;
	setAddEntityToCollectionsData: (data: {
		entityLot: EntityLot;
		entityId: string;
	}) => void;
	exerciseDetails: { id: string; name: string };
	setEntityToReview: (data: {
		entityLot: EntityLot;
		entityId: string;
		entityTitle: string;
	}) => void;
	canCurrentUserUpdate: boolean;
	setMergingExercise: (id: string) => void;
	navigate: NavigateFunction;
}) => {
	return (
		<MediaScrollArea>
			<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
				<Button variant="outline" onClick={props.openUpdatePreferencesModal}>
					Update preferences
				</Button>
				<Button
					variant="outline"
					onClick={() => {
						props.setAddEntityToCollectionsData({
							entityLot: EntityLot.Exercise,
							entityId: props.exerciseDetails.id,
						});
					}}
				>
					Add to collection
				</Button>
				<Button
					variant="outline"
					w="100%"
					onClick={() => {
						props.setEntityToReview({
							entityLot: EntityLot.Exercise,
							entityId: props.exerciseDetails.id,
							entityTitle: props.exerciseDetails.name,
						});
					}}
				>
					Post a review
				</Button>
				{props.canCurrentUserUpdate ? (
					<Button
						variant="outline"
						component={Link}
						to={$path(
							"/fitness/exercises/update/:action",
							{ action: "edit" },
							{ id: props.exerciseDetails.id },
						)}
					>
						Edit exercise
					</Button>
				) : null}
				<Button
					variant="outline"
					onClick={() => {
						props.setMergingExercise(props.exerciseDetails.id);
						props.navigate($path("/fitness/exercises/list"));
					}}
				>
					Merge exercise
				</Button>
			</SimpleGrid>
		</MediaScrollArea>
	);
};

export const ExerciseReviewsTab = (props: {
	userExerciseDetails: {
		reviews: Array<{
			id: string;
		}>;
	};
	exerciseDetails: { id: string; name: string };
}) => {
	return (
		<MediaScrollArea>
			{props.userExerciseDetails.reviews.length > 0 ? (
				<Stack>
					{props.userExerciseDetails.reviews.map((r) => (
						<ReviewItemDisplay
							review={r}
							key={r.id}
							entityLot={EntityLot.Exercise}
							title={props.exerciseDetails.name}
							entityId={props.exerciseDetails.id}
						/>
					))}
				</Stack>
			) : (
				<Text>No reviews</Text>
			)}
		</MediaScrollArea>
	);
};
