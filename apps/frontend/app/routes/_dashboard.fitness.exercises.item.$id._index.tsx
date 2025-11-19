import { LineChart } from "@mantine/charts";
import {
	ActionIcon,
	Affix,
	Anchor,
	Box,
	Button,
	Container,
	Divider,
	Flex,
	Group,
	Image,
	List,
	Paper,
	ScrollArea,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
	rem,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { ExtendedBodyPart } from "@mjcdev/react-body-highlighter";
import {
	EntityLot,
	ExerciseSource,
	UpdateUserExerciseSettingsDocument,
	WorkoutSetPersonalBest,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	parseParameters,
	parseSearchQuery,
	sortBy,
	startCase,
} from "@ryot/ts-utils";
import {
	IconChartPie,
	IconCheck,
	IconMessageCircle2,
} from "@tabler/icons-react";
import {
	IconHistoryToggle,
	IconInfoCircle,
	IconTrophy,
	IconUser,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { Virtuoso } from "react-virtuoso";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { DisplayCollectionToEntity, SkeletonLoader } from "~/components/common";
import { ReviewItemDisplay } from "~/components/common/review";
import {
	ExerciseHistory,
	ExerciseMusclesModal,
	ExerciseUpdatePreferencesModal,
} from "~/components/fitness/components";
import {
	DisplayData,
	DisplayLifetimeStatistic,
	DisplayPersonalBest,
} from "~/components/fitness/exercise-display-components";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
	mapMuscleToBodyPart,
} from "~/components/fitness/utils";
import { MediaScrollArea } from "~/components/media/base-display";
import { dayjsLib, getDateFromTimeSpan } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useExerciseDetails,
	useIsFitnessActionActive,
	useUserDetails,
	useUserExerciseDetails,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import {
	addExerciseToCurrentWorkout,
	useCurrentWorkout,
	useExerciseImages,
	useMergingExercise,
} from "~/lib/state/fitness";
import { useAddEntityToCollections, useReviewEntity } from "~/lib/state/media";
import { FitnessEntity, TimeSpan } from "~/lib/types";
import type { Route } from "./+types/_dashboard.fitness.exercises.item.$id._index";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ params, request }: Route.LoaderArgs) => {
	const { id: exerciseId } = parseParameters(
		params,
		z.object({ id: z.string() }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);
	return { query, exerciseId };
};

export const meta = () => {
	return [{ title: "Exercise Details | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const userDetails = useUserDetails();

	const exerciseDetailsQuery = useExerciseDetails(loaderData.exerciseId);
	const userExerciseDetailsQuery = useUserExerciseDetails(
		loaderData.exerciseId,
	);

	const exerciseDetails = exerciseDetailsQuery.data;
	const userExerciseDetails = userExerciseDetailsQuery.data;

	const canCurrentUserUpdate =
		exerciseDetails?.source === ExerciseSource.Custom &&
		userDetails.id === exerciseDetails.createdByUserId;
	const exerciseNumTimesInteracted =
		userExerciseDetails?.details?.exerciseNumTimesInteracted || 0;
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const navigate = useNavigate();
	const isFitnessActionActive = useIsFitnessActionActive();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();
	const [timeSpanForCharts, setTimeSpanForCharts] = useLocalStorage(
		"ExerciseChartTimeSpan",
		TimeSpan.Last90Days,
	);
	const [_m, setMergingExercise] = useMergingExercise();
	const [_r, setEntityToReview] = useReviewEntity();
	const [
		updatePreferencesModalOpened,
		{ open: openUpdatePreferencesModal, close: closeUpdatePreferencesModal },
	] = useDisclosure(false);
	const [
		musclesModalOpened,
		{ open: openMusclesModal, close: closeMusclesModal },
	] = useDisclosure(false);
	const [bodyViewSide, setBodyViewSide] = useLocalStorage<"front" | "back">(
		"ExerciseBodyViewSide",
		"front",
	);
	const [bodyViewGender, setBodyViewGender] = useLocalStorage<
		"male" | "female"
	>("ExerciseBodyViewGender", "female");
	const [changingExerciseSettings, setChangingExerciseSettings] = useState({
		isChanged: false,
		value: userExerciseDetails?.details?.exerciseExtraInformation?.settings || {
			excludeFromAnalytics: false,
			setRestTimers: {},
		},
	});

	const updateUserExerciseSettingsMutation = useMutation({
		mutationFn: async () => {
			await clientGqlService.request(UpdateUserExerciseSettingsDocument, {
				input: {
					exerciseId: exerciseDetails?.id || "",
					change: changingExerciseSettings.value,
				},
			});
		},
	});

	const computedDateAfterForCharts = getDateFromTimeSpan(timeSpanForCharts);
	const filteredHistoryForCharts = sortBy(
		userExerciseDetails?.history || [],
		(e) => e.workoutEndOn,
	).filter((h) => {
		const workoutEndOn = dayjsLib(h.workoutEndOn);
		return computedDateAfterForCharts === null
			? true
			: workoutEndOn.isAfter(computedDateAfterForCharts);
	});
	const bestMappings =
		coreDetails.exerciseParameters.lotMapping.find(
			(lm) => lm.lot === exerciseDetails?.lot,
		)?.bests || [];
	const images = useExerciseImages(exerciseDetails);

	const bodyPartsData: ExtendedBodyPart[] =
		exerciseDetails?.muscles
			?.map((muscle) => {
				const bodyPart = mapMuscleToBodyPart(muscle);
				return bodyPart ? { slug: bodyPart } : null;
			})
			.filter((part) => part !== null) || [];

	if (!exerciseDetails || !userExerciseDetails) {
		return (
			<Container size="xs" px="lg">
				<SkeletonLoader />
			</Container>
		);
	}

	return (
		<>
			<ExerciseUpdatePreferencesModal
				opened={updatePreferencesModalOpened}
				onClose={closeUpdatePreferencesModal}
				userExerciseDetails={userExerciseDetails}
				changingExerciseSettings={changingExerciseSettings}
				setChangingExerciseSettings={setChangingExerciseSettings}
				updateUserExerciseSettingsMutation={updateUserExerciseSettingsMutation}
			/>
			<ExerciseMusclesModal
				opened={musclesModalOpened}
				onClose={closeMusclesModal}
				bodyViewSide={bodyViewSide}
				setBodyViewSide={setBodyViewSide}
				bodyViewGender={bodyViewGender}
				setBodyViewGender={setBodyViewGender}
				bodyPartsData={bodyPartsData}
			/>
			<Container size="xs" px="lg">
				<Stack>
					<Title id="exercise-title">{exerciseDetails.name}</Title>
					{userExerciseDetails.collections.length > 0 ? (
						<Group id="entity-collections">
							{userExerciseDetails.collections.map((col) => (
								<DisplayCollectionToEntity
									col={col}
									key={col.id}
									entityLot={EntityLot.Exercise}
									entityId={exerciseDetails.id}
								/>
							))}
						</Group>
					) : null}
					<Tabs
						variant="outline"
						keepMounted={false}
						defaultValue={loaderData.query.defaultTab || "overview"}
					>
						<Tabs.List mb="xs">
							<Tabs.Tab
								value="overview"
								leftSection={<IconInfoCircle size={16} />}
							>
								Overview
							</Tabs.Tab>
							{exerciseNumTimesInteracted > 0 ? (
								<Tabs.Tab
									value="history"
									leftSection={<IconHistoryToggle size={16} />}
								>
									History
								</Tabs.Tab>
							) : null}
							{exerciseNumTimesInteracted > 0 ? (
								<>
									<Tabs.Tab
										value="records"
										leftSection={<IconTrophy size={16} />}
									>
										Records
									</Tabs.Tab>
									<Tabs.Tab
										value="charts"
										leftSection={<IconChartPie size={16} />}
									>
										Charts
									</Tabs.Tab>
								</>
							) : null}
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
							{!userPreferences.general.disableReviews ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : null}
						</Tabs.List>
						<Tabs.Panel value="overview">
							<Stack>
								<ScrollArea>
									<Flex gap={6}>
										{images.map((i) => (
											<Image key={i} radius="md" src={i} h="200px" w="248px" />
										))}
									</Flex>
								</ScrollArea>
								<SimpleGrid py="xs" cols={4}>
									{(["level", "force", "mechanic", "equipment"] as const).map(
										(f) => (
											<Fragment key={f}>
												{exerciseDetails[f] ? (
													<DisplayData name={f} data={exerciseDetails[f]} />
												) : null}
											</Fragment>
										),
									)}
									{exerciseDetails.lot ? (
										<DisplayData
											name="Type"
											data={changeCase(exerciseDetails.lot)}
										/>
									) : null}
									{exerciseNumTimesInteracted > 0 ? (
										<DisplayData
											noCasing
											name="Times done"
											data={`${exerciseNumTimesInteracted} times`}
										/>
									) : null}
									{(userExerciseDetails.history?.length || 0) > 0 ? (
										<>
											{userExerciseDetails.details?.createdOn ? (
												<DisplayData
													noCasing
													name="First done on"
													data={dayjsLib(
														userExerciseDetails.details.createdOn,
													).format("ll")}
												/>
											) : null}
											{userExerciseDetails.details?.lastUpdatedOn ? (
												<DisplayData
													noCasing
													name="Last done on"
													data={dayjsLib(
														userExerciseDetails.details.lastUpdatedOn,
													).format("ll")}
												/>
											) : null}
										</>
									) : null}
								</SimpleGrid>
								{exerciseDetails.muscles.length > 0 ? (
									<>
										<Divider />
										<Group wrap="nowrap">
											<Anchor fz="sm" onClick={openMusclesModal}>
												Muscles
											</Anchor>
											<Text fz="sm">
												{exerciseDetails.muscles
													.map((s) => startCase(s.toLowerCase()))
													.join(", ")}
											</Text>
										</Group>
									</>
								) : null}
								{exerciseDetails.instructions.length > 0 ? (
									<>
										<Divider />
										<Text size="xl" fw="bold">
											Instructions
										</Text>
										<List type="ordered" spacing="xs">
											{exerciseDetails.instructions.map((d) => (
												<List.Item key={d}>{d}</List.Item>
											))}
										</List>
									</>
								) : null}
							</Stack>
						</Tabs.Panel>
						{userExerciseDetails.history ? (
							<Tabs.Panel value="history" h="68vh">
								<Virtuoso
									data={userExerciseDetails.history}
									itemContent={(index, history) => (
										<Box mt={index !== 0 ? "md" : undefined}>
											<ExerciseHistory
												hideExerciseDetails
												key={history.workoutId}
												exerciseIdx={history.idx}
												entityId={history.workoutId}
												fitnessEntityType={FitnessEntity.Workouts}
											/>
										</Box>
									)}
								/>
							</Tabs.Panel>
						) : null}
						{userExerciseDetails.details?.exerciseExtraInformation ? (
							<>
								<Tabs.Panel value="records">
									<Stack gap="xl">
										<Stack gap="xs">
											<Text size="lg" td="underline">
												Lifetime Stats
											</Text>
											<Box>
												<DisplayLifetimeStatistic
													stat="weight"
													val={displayWeightWithUnit(
														unitSystem,
														userExerciseDetails.details.exerciseExtraInformation
															.lifetimeStats.weight,
													)}
												/>
												<DisplayLifetimeStatistic
													stat="distance"
													val={displayDistanceWithUnit(
														unitSystem,
														userExerciseDetails.details.exerciseExtraInformation
															.lifetimeStats.distance,
													)}
												/>
												<DisplayLifetimeStatistic
													stat="duration"
													val={`${userExerciseDetails.details.exerciseExtraInformation.lifetimeStats.duration} MIN`}
												/>
												<DisplayLifetimeStatistic
													stat="reps"
													val={
														userExerciseDetails.details.exerciseExtraInformation
															.lifetimeStats.reps
													}
												/>
												<DisplayLifetimeStatistic
													stat="times done"
													val={exerciseNumTimesInteracted}
												/>
											</Box>
										</Stack>
										{userExerciseDetails.details.exerciseExtraInformation
											.personalBests.length > 0 ? (
											<Stack gap="sm">
												<Text size="lg" td="underline">
													Personal Bests
												</Text>
												{userExerciseDetails.details.exerciseExtraInformation.personalBests.map(
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
								</Tabs.Panel>
								<Tabs.Panel value="charts">
									<Stack>
										<Select
											label="Time span"
											labelProps={{ c: "dimmed" }}
											defaultValue={timeSpanForCharts}
											data={convertEnumToSelectData(TimeSpan)}
											onChange={(v) => {
												if (v) setTimeSpanForCharts(v as TimeSpan);
											}}
										/>
										{bestMappings.map((best) => {
											const data = filteredHistoryForCharts.map((h) => {
												const stat = h.bestSet?.statistic;
												const value = match(best)
													.with(WorkoutSetPersonalBest.OneRm, () => stat?.oneRm)
													.with(WorkoutSetPersonalBest.Pace, () => stat?.pace)
													.with(WorkoutSetPersonalBest.Reps, () => stat?.reps)
													.with(
														WorkoutSetPersonalBest.Time,
														() => stat?.duration,
													)
													.with(
														WorkoutSetPersonalBest.Volume,
														() => stat?.volume,
													)
													.with(
														WorkoutSetPersonalBest.Weight,
														() => stat?.weight,
													)
													.with(
														WorkoutSetPersonalBest.Distance,
														() => stat?.distance,
													)
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
															series={[
																{ name: "value", label: changeCase(best) },
															]}
														/>
													</Stack>
												</Paper>
											) : null;
										})}
									</Stack>
								</Tabs.Panel>
							</>
						) : null}
						<Tabs.Panel value="actions">
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
									<Button
										variant="outline"
										onClick={() => openUpdatePreferencesModal()}
									>
										Update preferences
									</Button>
									<Button
										variant="outline"
										onClick={() => {
											setAddEntityToCollectionsData({
												entityLot: EntityLot.Exercise,
												entityId: exerciseDetails.id,
											});
										}}
									>
										Add to collection
									</Button>
									<Button
										variant="outline"
										w="100%"
										onClick={() => {
											setEntityToReview({
												entityLot: EntityLot.Exercise,
												entityId: exerciseDetails.id,
												entityTitle: exerciseDetails.name,
											});
										}}
									>
										Post a review
									</Button>
									<Button
										component={Link}
										variant="outline"
										to={$path(
											"/fitness/exercises/update/:action",
											{ action: "create" },
											{ duplicateId: exerciseDetails.id },
										)}
									>
										Duplicate exercise
									</Button>
									{canCurrentUserUpdate ? (
										<Button
											variant="outline"
											component={Link}
											to={$path(
												"/fitness/exercises/update/:action",
												{ action: "edit" },
												{ id: exerciseDetails.id },
											)}
										>
											Edit exercise
										</Button>
									) : null}
									<Button
										variant="outline"
										onClick={() => {
											setMergingExercise(exerciseDetails.id);
											navigate($path("/fitness/exercises/list"));
										}}
									>
										Merge exercise
									</Button>
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						{!userPreferences.general.disableReviews ? (
							<Tabs.Panel value="reviews">
								<MediaScrollArea>
									{userExerciseDetails.reviews.length > 0 ? (
										<Stack>
											{userExerciseDetails.reviews.map((r) => (
												<ReviewItemDisplay
													review={r}
													key={r.id}
													title={exerciseDetails.name}
													entityId={exerciseDetails.id}
													entityLot={EntityLot.Exercise}
												/>
											))}
										</Stack>
									) : (
										<Text>No reviews</Text>
									)}
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
					</Tabs>
				</Stack>
				{currentWorkout && isFitnessActionActive ? (
					<Affix position={{ bottom: rem(40), right: rem(30) }}>
						<ActionIcon
							size="xl"
							radius="xl"
							color="blue"
							variant="light"
							onClick={async () => {
								setMergingExercise(null);
								await addExerciseToCurrentWorkout(
									navigate,
									currentWorkout,
									userPreferences.fitness,
									setCurrentWorkout,
									[{ id: exerciseDetails.id, lot: exerciseDetails.lot }],
								);
							}}
						>
							<IconCheck size={32} />
						</ActionIcon>
					</Affix>
				) : null}
			</Container>
		</>
	);
}
