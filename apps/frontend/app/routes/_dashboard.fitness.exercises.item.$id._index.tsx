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
import { unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
	EntityLot,
	ExerciseDetailsDocument,
	ExerciseSource,
	UserExerciseDetailsDocument,
	WorkoutSetPersonalBest,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, reverse, startCase } from "@ryot/ts-utils";
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
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Virtuoso } from "react-virtuoso";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withFragment } from "ufo";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { zx } from "zodix";
import { DisplayCollection, ReviewItemDisplay } from "~/components/common";
import {
	ExerciseHistory,
	displayDistanceWithUnit,
	displayWeightWithUnit,
} from "~/components/fitness";
import { MediaScrollArea } from "~/components/media";
import { TimeSpan, dayjsLib, getDateFromTimeSpan } from "~/lib/generals";
import {
	useUserDetails,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/hooks";
import {
	addExerciseToWorkout,
	getWorkoutDetailsQuery,
	useCurrentWorkout,
} from "~/lib/state/fitness";
import { useAddEntityToCollection, useReviewEntity } from "~/lib/state/media";
import {
	getCachedExerciseParameters,
	getWorkoutCookieValue,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ params, request }) => {
	const { id: exerciseId } = zx.parseParams(params, { id: z.string() });
	const query = zx.parseQuery(request, searchParamsSchema);
	const workoutInProgress = !!getWorkoutCookieValue(request);
	const [exerciseParameters, { exerciseDetails }, { userExerciseDetails }] =
		await Promise.all([
			getCachedExerciseParameters(),
			serverGqlService.request(ExerciseDetailsDocument, { exerciseId }),
			serverGqlService.authenticatedRequest(
				request,
				UserExerciseDetailsDocument,
				{ exerciseId },
			),
		]);
	return {
		query,
		exerciseId,
		exerciseDetails,
		workoutInProgress,
		exerciseParameters,
		userExerciseDetails,
	};
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.exerciseDetails.id} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const userDetails = useUserDetails();
	const canCurrentUserUpdate =
		loaderData.exerciseDetails.source === ExerciseSource.Custom &&
		userDetails.id === loaderData.exerciseDetails.createdByUserId;
	const exerciseNumTimesInteracted =
		loaderData.userExerciseDetails.details?.exerciseNumTimesInteracted || 0;
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const navigate = useNavigate();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();
	const [timeSpan, setTimeSpan] = useLocalStorage(
		"ExerciseChartTimeSpan",
		TimeSpan.Last90Days,
	);
	const computedDateAfter = getDateFromTimeSpan(timeSpan);
	const bestMappings =
		loaderData.exerciseParameters.lotMapping.find(
			(lm) => lm.lot === loaderData.exerciseDetails.lot,
		)?.bests || [];
	const [_r, setEntityToReview] = useReviewEntity();

	return (
		<Container size="xs" px="lg">
			<Stack>
				<Title id="exercise-title">{loaderData.exerciseDetails.id}</Title>
				{loaderData.userExerciseDetails.collections.length > 0 ? (
					<Group id="entity-collections">
						{loaderData.userExerciseDetails.collections.map((col) => (
							<DisplayCollection
								col={col}
								key={col.id}
								creatorUserId={col.userId}
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
									{loaderData.exerciseDetails.attributes.images.map((i) => (
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
											loaderData.userExerciseDetails.details.lastUpdatedOn,
										).format("ll")}
										noCasing
									/>
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
							{loaderData.exerciseDetails.attributes.instructions.length > 0 ? (
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
										/>
									</Box>
								)}
							/>
						</Tabs.Panel>
					) : null}
					{loaderData.userExerciseDetails.details?.exerciseExtraInformation ? (
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
										defaultValue={timeSpan}
										labelProps={{ c: "dimmed" }}
										data={Object.values(TimeSpan)}
										onChange={(v) => {
											if (v) setTimeSpan(v as TimeSpan);
										}}
									/>
									{bestMappings.map((best) => {
										const reversedHistory = reverse(
											loaderData.userExerciseDetails.history || [],
										).filter((h) => {
											const workoutEndOn = dayjsLib(h.workoutEndOn);
											return computedDateAfter === null
												? true
												: workoutEndOn.isAfter(computedDateAfter);
										});
										const data = reversedHistory.map((h) => {
											const stat = h.bestSet?.statistic;
											const value = match(best)
												.with(WorkoutSetPersonalBest.OneRm, () => stat?.oneRm)
												.with(WorkoutSetPersonalBest.Pace, () => stat?.pace)
												.with(WorkoutSetPersonalBest.Reps, () => stat?.reps)
												.with(WorkoutSetPersonalBest.Time, () => stat?.duration)
												.with(WorkoutSetPersonalBest.Volume, () => stat?.volume)
												.with(WorkoutSetPersonalBest.Weight, () => stat?.weight)
												.exhaustive();
											return {
												name: dayjsLib(h.workoutEndOn).format("DD/MM/YYYY"),
												value: value ? Number.parseFloat(value) : null,
											};
										});
										invariant(data);
										return (
											<Paper key={best} withBorder py="md" radius="md">
												<Stack>
													<Title order={3} ta="center">
														{changeCase(best)}
													</Title>
													<LineChart
														ml={-15}
														connectNulls
														h={300}
														data={data}
														series={[
															{ name: "value", label: changeCase(best) },
														]}
														dataKey="name"
													/>
												</Stack>
											</Paper>
										);
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
									onClick={() => {
										setAddEntityToCollectionData({
											entityId: loaderData.exerciseId,
											entityLot: EntityLot.Exercise,
											alreadyInCollections:
												loaderData.userExerciseDetails.collections.map(
													(c) => c.id,
												),
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
											entityTitle: loaderData.exerciseDetails.id,
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
											{ name: loaderData.exerciseDetails.id },
										)}
									>
										Edit exercise
									</Button>
								) : null}
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
			{currentWorkout && loaderData.workoutInProgress ? (
				<Affix position={{ bottom: rem(40), right: rem(30) }}>
					<ActionIcon
						color="blue"
						variant="light"
						radius="xl"
						size="xl"
						onClick={async () => {
							await addExerciseToWorkout(
								currentWorkout,
								setCurrentWorkout,
								[
									{
										name: loaderData.exerciseDetails.id,
										lot: loaderData.exerciseDetails.lot,
									},
								],
								navigate,
							);
						}}
					>
						<IconCheck size={32} />
					</ActionIcon>
				</Affix>
			) : null}
		</Container>
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
					.exhaustive()}
			</Text>
			<Group>
				<Text size="sm">{dayjsLib(data.details.endTime).format("ll")}</Text>
				<Anchor
					component={Link}
					to={withFragment(
						$path("/fitness/:entity/:id", {
							entity: "workouts",
							id: props.set.workoutId,
						}),
						props.set.exerciseIdx.toString(),
					)}
					fw="bold"
				>
					<IconExternalLink size={16} />
				</Anchor>
			</Group>
		</Group>
	);
};
