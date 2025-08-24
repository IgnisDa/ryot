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
	Modal,
	NumberInput,
	Paper,
	ScrollArea,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Tabs,
	Text,
	Title,
	rem,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	EntityLot,
	ExerciseDetailsDocument,
	ExerciseSource,
	UpdateUserExerciseSettingsDocument,
	UserExerciseDetailsDocument,
	WorkoutSetPersonalBest,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	isNumber,
	parseParameters,
	parseSearchQuery,
	snakeCase,
	sortBy,
	startCase,
} from "@ryot/ts-utils";
import {
	IconChartPie,
	IconCheck,
	IconExternalLink,
	IconMessageCircle2,
} from "@tabler/icons-react";
import {
	IconHistoryToggle,
	IconInfoCircle,
	IconTrophy,
	IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { Fragment, useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { Virtuoso } from "react-virtuoso";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { DisplayCollectionToEntity } from "~/components/common";
import { ReviewItemDisplay } from "~/components/common/review";
import { ExerciseHistory } from "~/components/fitness/components";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
} from "~/components/fitness/utils";
import { MediaScrollArea } from "~/components/media/base-display";
import { dayjsLib, getDateFromTimeSpan } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useIsFitnessActionActive,
	useUserDetails,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import {
	addExerciseToCurrentWorkout,
	getExerciseImages,
	getWorkoutDetailsQuery,
	useCurrentWorkout,
	useMergingExercise,
} from "~/lib/state/fitness";
import { useAddEntityToCollections, useReviewEntity } from "~/lib/state/media";
import { FitnessEntity, TimeSpan } from "~/lib/types";
import { serverGqlService } from "~/lib/utilities.server";
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
	const [{ exerciseDetails }, { userExerciseDetails }] = await Promise.all([
		serverGqlService.request(ExerciseDetailsDocument, { exerciseId }),
		serverGqlService.authenticatedRequest(
			request,
			UserExerciseDetailsDocument,
			{ exerciseId },
		),
	]);
	return { query, exerciseId, exerciseDetails, userExerciseDetails };
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
	const revalidator = useRevalidator();
	const canCurrentUserUpdate =
		loaderData.exerciseDetails.source === ExerciseSource.Custom &&
		userDetails.id === loaderData.exerciseDetails.createdByUserId;
	const exerciseNumTimesInteracted =
		loaderData.userExerciseDetails.details?.exerciseNumTimesInteracted || 0;
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
	const [changingExerciseSettings, setChangingExerciseSettings] = useState({
		isChanged: false,
		value: loaderData.userExerciseDetails.details?.exerciseExtraInformation
			?.settings || { excludeFromAnalytics: false, setRestTimers: {} },
	});

	const updateUserExerciseSettingsMutation = useMutation({
		mutationFn: async () => {
			await clientGqlService.request(UpdateUserExerciseSettingsDocument, {
				input: {
					exerciseId: loaderData.exerciseId,
					change: changingExerciseSettings.value,
				},
			});
		},
	});

	const computedDateAfterForCharts = getDateFromTimeSpan(timeSpanForCharts);
	const filteredHistoryForCharts = sortBy(
		loaderData.userExerciseDetails.history || [],
		(e) => e.workoutEndOn,
	).filter((h) => {
		const workoutEndOn = dayjsLib(h.workoutEndOn);
		return computedDateAfterForCharts === null
			? true
			: workoutEndOn.isAfter(computedDateAfterForCharts);
	});
	const bestMappings =
		coreDetails.exerciseParameters.lotMapping.find(
			(lm) => lm.lot === loaderData.exerciseDetails.lot,
		)?.bests || [];
	const images = getExerciseImages(loaderData.exerciseDetails);

	return (
		<>
			<Modal
				centered
				withCloseButton={false}
				opened={updatePreferencesModalOpened}
				onClose={() => closeUpdatePreferencesModal()}
			>
				<Stack>
					<Switch
						label="Exclude from analytics"
						defaultChecked={
							loaderData.userExerciseDetails.details?.exerciseExtraInformation
								?.settings.excludeFromAnalytics
						}
						onChange={(ev) => {
							setChangingExerciseSettings(
								produce(changingExerciseSettings, (draft) => {
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
							Default rest timer durations for all exercises can be changed in
							the fitness preferences.
						</Text>
					</Text>
					<SimpleGrid cols={2}>
						{(["normal", "warmup", "drop", "failure"] as const).map((name) => {
							const value =
								loaderData.userExerciseDetails.details?.exerciseExtraInformation
									?.settings.setRestTimers[name];
							return (
								<NumberInput
									suffix="s"
									key={name}
									label={changeCase(snakeCase(name))}
									defaultValue={isNumber(value) ? value : undefined}
									onChange={(val) => {
										if (isNumber(val))
											setChangingExerciseSettings(
												produce(changingExerciseSettings, (draft) => {
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
						disabled={!changingExerciseSettings.isChanged}
						loading={updateUserExerciseSettingsMutation.isPending}
						onClick={async () => {
							await updateUserExerciseSettingsMutation.mutateAsync();
							revalidator.revalidate();
							notifications.show({
								color: "green",
								title: "Settings updated",
								message: "Settings for the exercise have been updated.",
							});
							closeUpdatePreferencesModal();
						}}
					>
						Save settings
					</Button>
				</Stack>
			</Modal>
			<Container size="xs" px="lg">
				<Stack>
					<Title id="exercise-title">{loaderData.exerciseDetails.name}</Title>
					{loaderData.userExerciseDetails.collections.length > 0 ? (
						<Group id="entity-collections">
							{loaderData.userExerciseDetails.collections.map((col) => (
								<DisplayCollectionToEntity
									col={col}
									key={col.id}
									entityLot={EntityLot.Exercise}
									entityId={loaderData.exerciseDetails.id}
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
												{loaderData.exerciseDetails[f] ? (
													<DisplayData
														name={f}
														data={loaderData.exerciseDetails[f]}
													/>
												) : null}
											</Fragment>
										),
									)}
									{loaderData.exerciseDetails.lot ? (
										<DisplayData
											name="Type"
											data={changeCase(loaderData.exerciseDetails.lot)}
										/>
									) : null}
									{exerciseNumTimesInteracted > 0 ? (
										<DisplayData
											name="Times done"
											data={`${exerciseNumTimesInteracted} times`}
											noCasing
										/>
									) : null}
									{(loaderData.userExerciseDetails.history?.length || 0) > 0 ? (
										<>
											{loaderData.userExerciseDetails.details?.createdOn ? (
												<DisplayData
													name="First done on"
													data={dayjsLib(
														loaderData.userExerciseDetails.details.createdOn,
													).format("ll")}
													noCasing
												/>
											) : null}
											{loaderData.userExerciseDetails.details?.lastUpdatedOn ? (
												<DisplayData
													name="Last done on"
													data={dayjsLib(
														loaderData.userExerciseDetails.details
															.lastUpdatedOn,
													).format("ll")}
													noCasing
												/>
											) : null}
										</>
									) : null}
								</SimpleGrid>
								{loaderData.exerciseDetails.muscles.length > 0 ? (
									<>
										<Divider />
										<Group wrap="nowrap">
											<Text c="dimmed" fz="sm">
												Muscles
											</Text>
											<Text fz="sm">
												{loaderData.exerciseDetails.muscles
													.map((s) => startCase(s.toLowerCase()))
													.join(", ")}
											</Text>
										</Group>
									</>
								) : null}
								{loaderData.exerciseDetails.attributes.instructions.length >
								0 ? (
									<>
										<Divider />
										<Text size="xl" fw="bold">
											Instructions
										</Text>
										<List type="ordered" spacing="xs">
											{loaderData.exerciseDetails.attributes.instructions.map(
												(d) => (
													<List.Item key={d}>{d}</List.Item>
												),
											)}
										</List>
									</>
								) : null}
							</Stack>
						</Tabs.Panel>
						{loaderData.userExerciseDetails.history ? (
							<Tabs.Panel value="history" h="68vh">
								<Virtuoso
									data={loaderData.userExerciseDetails.history}
									itemContent={(index, history) => (
										<Box mt={index !== 0 ? "md" : undefined}>
											<ExerciseHistory
												hideExerciseDetails
												key={history.workoutId}
												exerciseIdx={history.idx}
												entityId={history.workoutId}
												entityType={FitnessEntity.Workouts}
											/>
										</Box>
									)}
								/>
							</Tabs.Panel>
						) : null}
						{loaderData.userExerciseDetails.details
							?.exerciseExtraInformation ? (
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
														loaderData.userExerciseDetails.details
															.exerciseExtraInformation.lifetimeStats.weight,
													)}
												/>
												<DisplayLifetimeStatistic
													stat="distance"
													val={displayDistanceWithUnit(
														unitSystem,
														loaderData.userExerciseDetails.details
															.exerciseExtraInformation.lifetimeStats.distance,
													)}
												/>
												<DisplayLifetimeStatistic
													stat="duration"
													val={`${loaderData.userExerciseDetails.details.exerciseExtraInformation.lifetimeStats.duration} MIN`}
												/>
												<DisplayLifetimeStatistic
													stat="reps"
													val={
														loaderData.userExerciseDetails.details
															.exerciseExtraInformation.lifetimeStats.reps
													}
												/>
												<DisplayLifetimeStatistic
													stat="times done"
													val={exerciseNumTimesInteracted}
												/>
											</Box>
										</Stack>
										{loaderData.userExerciseDetails.details
											.exerciseExtraInformation.personalBests.length > 0 ? (
											<Stack gap="sm">
												<Text size="lg" td="underline">
													Personal Bests
												</Text>
												{loaderData.userExerciseDetails.details.exerciseExtraInformation.personalBests.map(
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
												entityId: loaderData.exerciseId,
												entityLot: EntityLot.Exercise,
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
												entityId: loaderData.exerciseId,
												entityLot: EntityLot.Exercise,
												entityTitle: loaderData.exerciseDetails.name,
											});
										}}
									>
										Post a review
									</Button>
									{canCurrentUserUpdate ? (
										<Button
											variant="outline"
											component={Link}
											to={$path(
												"/fitness/exercises/:action",
												{ action: "update" },
												{ id: loaderData.exerciseDetails.id },
											)}
										>
											Edit exercise
										</Button>
									) : null}
									<Button
										variant="outline"
										onClick={() => {
											setMergingExercise(loaderData.exerciseDetails.id);
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
									{loaderData.userExerciseDetails.reviews.length > 0 ? (
										<Stack>
											{loaderData.userExerciseDetails.reviews.map((r) => (
												<ReviewItemDisplay
													review={r}
													key={r.id}
													entityLot={EntityLot.Exercise}
													entityId={loaderData.exerciseId}
													title={loaderData.exerciseDetails.id}
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
							color="blue"
							variant="light"
							radius="xl"
							size="xl"
							onClick={async () => {
								await addExerciseToCurrentWorkout(
									navigate,
									currentWorkout,
									userPreferences.fitness,
									setCurrentWorkout,
									[
										{
											id: loaderData.exerciseDetails.id,
											lot: loaderData.exerciseDetails.lot,
										},
									],
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

const DisplayData = (props: {
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

const DisplayLifetimeStatistic = (props: {
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

const DisplayPersonalBest = (props: {
	set: { workoutId: string; exerciseIdx: number; setIdx: number };
	personalBestLot: WorkoutSetPersonalBest;
}) => {
	const unitSystem = useUserUnitSystem();
	const { data } = useQuery(getWorkoutDetailsQuery(props.set.workoutId));
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
