import { $path } from "@ignisda/remix-routes";
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
	ScrollArea,
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
import {
	changeCase,
	displayDistanceWithUnit,
	displayWeightWithUnit,
	isString,
	startCase,
} from "@ryot/ts-utils";
import { IconCheck, IconExternalLink } from "@tabler/icons-react";
import {
	IconHistoryToggle,
	IconInfoCircle,
	IconTrophy,
	IconUser,
} from "@tabler/icons-react";
import { Fragment } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withFragment } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { ExerciseHistory } from "~/components/fitness";
import { DisplayCollection, MediaScrollArea } from "~/components/media";
import { dayjsLib } from "~/lib/generals";
import { useUserDetails, useUserPreferences } from "~/lib/hooks";
import { useAddEntityToCollection } from "~/lib/state/media";
import { addExerciseToWorkout, useCurrentWorkout } from "~/lib/state/workout";
import {
	getAuthorizationHeader,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ params, request }) => {
	const exerciseId = params.id;
	invariant(isString(exerciseId));
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ exerciseDetails }, { userExerciseDetails }] = await Promise.all([
		serverGqlService.request(ExerciseDetailsDocument, { exerciseId }),
		serverGqlService.request(
			UserExerciseDetailsDocument,
			{ exerciseId },
			getAuthorizationHeader(request),
		),
	]);
	return { query, exerciseDetails, userExerciseDetails, exerciseId };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.exerciseDetails.id} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const unitSystem = userPreferences.fitness.exercises.unitSystem;
	const userDetails = useUserDetails();
	const canCurrentUserUpdate =
		loaderData.exerciseDetails.source === ExerciseSource.Custom &&
		userDetails.id === loaderData.exerciseDetails.createdByUserId;
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const navigate = useNavigate();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();

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
					defaultValue={loaderData.query.defaultTab || "overview"}
				>
					<Tabs.List mb="xs">
						<Tabs.Tab
							value="overview"
							leftSection={<IconInfoCircle size={16} />}
						>
							Overview
						</Tabs.Tab>
						{loaderData.userExerciseDetails.history ? (
							<Tabs.Tab
								value="history"
								leftSection={<IconHistoryToggle size={16} />}
							>
								History
							</Tabs.Tab>
						) : null}
						{loaderData.userExerciseDetails.details ? (
							<Tabs.Tab value="records" leftSection={<IconTrophy size={16} />}>
								Records
							</Tabs.Tab>
						) : null}
						<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
							Actions
						</Tabs.Tab>
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
								{loaderData.userExerciseDetails.details
									?.exerciseNumTimesInteracted ? (
									<DisplayData
										name="Times done"
										data={`${loaderData.userExerciseDetails.details.exerciseNumTimesInteracted} times`}
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
						<Tabs.Panel value="history">
							<Stack>
								{loaderData.userExerciseDetails.history.map((history) => (
									<ExerciseHistory
										history={history}
										key={history.workoutId}
										exerciseId={loaderData.exerciseDetails.id}
										exerciseLot={loaderData.exerciseDetails.lot}
									/>
								))}
							</Stack>
						</Tabs.Panel>
					) : null}
					{loaderData.userExerciseDetails.details?.exerciseExtraInformation ? (
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
											val={
												loaderData.userExerciseDetails.details
													.exerciseNumTimesInteracted || 0
											}
										/>
									</Box>
								</Stack>
								{loaderData.userExerciseDetails.details.exerciseExtraInformation
									.personalBests.length > 0 ? (
									<Stack gap="sm">
										<Text size="lg" td="underline">
											Personal Bests
										</Text>
										{loaderData.userExerciseDetails.details.exerciseExtraInformation.personalBests.map(
											(pb) => (
												<Box key={pb.lot}>
													<Text size="sm" c="dimmed">
														{changeCase(pb.lot)}
													</Text>
													<Stack gap={0}>
														{pb.sets.map((s) => (
															<Group
																justify="space-between"
																key={`${s.workoutId}-${s.setIdx}`}
															>
																<Text size="sm">
																	{match(pb.lot)
																		.with(WorkoutSetPersonalBest.OneRm, () =>
																			Number(s.data.statistic.oneRm).toFixed(2),
																		)
																		.with(
																			WorkoutSetPersonalBest.Reps,
																			() => s.data.statistic.reps,
																		)
																		.with(
																			WorkoutSetPersonalBest.Time,
																			() => `${s.data.statistic.duration} min`,
																		)
																		.with(WorkoutSetPersonalBest.Volume, () =>
																			displayWeightWithUnit(
																				unitSystem,
																				s.data.statistic.volume,
																			),
																		)
																		.with(WorkoutSetPersonalBest.Weight, () =>
																			displayWeightWithUnit(
																				unitSystem,
																				s.data.statistic.weight,
																			),
																		)
																		.with(
																			WorkoutSetPersonalBest.Pace,
																			() => `${s.data.statistic.pace}/min`,
																		)
																		.exhaustive()}
																</Text>
																<Group>
																	<Text size="sm">
																		{dayjsLib(s.workoutDoneOn).format("ll")}
																	</Text>
																	<Anchor
																		component={Link}
																		to={withFragment(
																			$path("/fitness/workouts/:id", {
																				id: s.workoutId,
																			}),
																			`${loaderData.exerciseDetails.id}__${s.exerciseIdx}`,
																		)}
																		fw="bold"
																	>
																		<IconExternalLink size={16} />
																	</Anchor>
																</Group>
															</Group>
														))}
													</Stack>
												</Box>
											),
										)}
									</Stack>
								) : null}
							</Stack>
						</Tabs.Panel>
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
				</Tabs>
			</Stack>
			{currentWorkout ? (
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
