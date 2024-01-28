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
	Paper,
	ScrollArea,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
	rem,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
	EntityLot,
	ExerciseDetailsDocument,
	SetLot,
	UserCollectionsListDocument,
	UserExerciseDetailsDocument,
	WorkoutSetPersonalBest,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	displayDistanceWithUnit,
	displayWeightWithUnit,
	startCase,
} from "@ryot/ts-utils";
import { IconCheck, IconExternalLink } from "@tabler/icons-react";
import {
	IconHistoryToggle,
	IconInfoCircle,
	IconTrophy,
	IconUser,
} from "@tabler/icons-react";
import { useAtom } from "jotai";
import { Fragment } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { DisplayExerciseStats } from "~/components/fitness";
import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
} from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { dayjsLib, getSetColor } from "~/lib/generals";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import { addExerciseToWorkout, currentWorkoutAtom } from "~/lib/workout";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional(),
	selectionEnabled: zx.BoolAsString.optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
	const exerciseId = params.id;
	invariant(typeof exerciseId === "string", "id must be a string");
	const query = zx.parseQuery(request, searchParamsSchema);
	const [
		coreDetails,
		userPreferences,
		{ exerciseDetails },
		{ userExerciseDetails },
		{ userCollectionsList: collections },
	] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
		gqlClient.request(ExerciseDetailsDocument, { exerciseId }),
		gqlClient.request(
			UserExerciseDetailsDocument,
			{ input: { exerciseId } },
			await getAuthorizationHeader(request),
		),
		gqlClient.request(
			UserCollectionsListDocument,
			{},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		query,
		exerciseDetails,
		userExerciseDetails,
		coreDetails: { itemDetailsHeight: coreDetails.itemDetailsHeight },
		userPreferences: {
			unitSystem: userPreferences.fitness.exercises.unitSystem,
		},
		exerciseId,
		collections,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).exerciseDetails.id
			} | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
	] = useDisclosure(false);
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const navigate = useNavigate();

	return (
		<Container size="xs" px="lg">
			<Stack>
				<Title id="exercise-title">{loaderData.exerciseDetails.id}</Title>
				{loaderData.userExerciseDetails.collections.length > 0 ? (
					<Group id="entity-collections">
						{loaderData.userExerciseDetails.collections.map((col) => (
							<DisplayCollection
								col={col}
								entityId={loaderData.exerciseDetails.id}
								entityLot={EntityLot.Exercise}
								key={col.id}
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
								{["level", "force", "mechanic", "equipment"].map((f) => (
									<Fragment key={f}>
										{/* biome-ignore lint/suspicious/noExplicitAny: required here */}
										{(loaderData.exerciseDetails as any)[f] ? (
											<DisplayData
												name={f}
												// biome-ignore lint/suspicious/noExplicitAny: required here
												data={(loaderData.exerciseDetails as any)[f]}
											/>
										) : null}
									</Fragment>
								))}
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
								{loaderData.userExerciseDetails.history.map((h) => (
									<Paper key={h.workoutId} withBorder p="xs">
										<Anchor
											component={Link}
											to={`${$path("/fitness/workouts/:id", {
												id: h.workoutId,
												// FIXME: Use the `withFragment` helper from ufo
											})}#${loaderData.exerciseDetails.id}__${h.index}`}
											fw="bold"
										>
											{h.workoutName}
										</Anchor>
										<Text c="dimmed" fz="sm" mb="xs">
											{dayjsLib(h.workoutTime).format("LLLL")}
										</Text>
										{h.sets.map((s, idx) => (
											<Flex key={`${idx}`} align="center">
												<Text
													fz="sm"
													c={getSetColor(s.lot)}
													mr="md"
													fw="bold"
													ff="monospace"
												>
													{match(s.lot)
														.with(SetLot.Normal, () => idx + 1)
														.otherwise(() => s.lot.at(0))}
												</Text>
												<DisplayExerciseStats
													lot={loaderData.exerciseDetails.lot}
													statistic={s.statistic}
													unit={loaderData.userPreferences.unitSystem}
												/>
											</Flex>
										))}
									</Paper>
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
												loaderData.userPreferences.unitSystem,
												loaderData.userExerciseDetails.details
													.exerciseExtraInformation.lifetimeStats.weight,
											)}
										/>
										<DisplayLifetimeStatistic
											stat="distance"
											val={displayDistanceWithUnit(
												loaderData.userPreferences.unitSystem,
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
															<Group justify="space-between">
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
																				loaderData.userPreferences.unitSystem,
																				s.data.statistic.volume,
																			),
																		)
																		.with(WorkoutSetPersonalBest.Weight, () =>
																			displayWeightWithUnit(
																				loaderData.userPreferences.unitSystem,
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
																		to={`${$path("/fitness/workouts/:id", {
																			id: s.workoutId,
																			// FIXME: Use the `withFragment` helper from ufo
																		})}#${loaderData.exerciseDetails.id}__${
																			s.exerciseIdx
																		}`}
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
						<MediaScrollArea
							itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
						>
							<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
								<Button variant="outline" onClick={collectionModalOpen}>
									Add to collection
								</Button>
								<AddEntityToCollectionModal
									onClose={collectionModalClose}
									opened={collectionModalOpened}
									entityId={loaderData.exerciseDetails.id}
									entityLot={EntityLot.Exercise}
									collections={loaderData.collections.map((c) => c.name)}
								/>
							</SimpleGrid>
						</MediaScrollArea>
					</Tabs.Panel>
				</Tabs>
			</Stack>
			{currentWorkout && loaderData.query.selectionEnabled ? (
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
	data: string;
	noCasing?: boolean;
}) => {
	return (
		<Box>
			<Text ta="center" c="dimmed" tt="capitalize" fz="xs">
				{startCase(props.name)}
			</Text>
			<Text ta="center" fz={{ base: "sm", md: "md" }}>
				{props.noCasing ? props.data : startCase(props.data.toLowerCase())}
			</Text>
		</Box>
	);
};

const DisplayLifetimeStatistic = (props: {
	val: string | number;
	stat: string;
}) => {
	return parseFloat(props.val.toString()) !== 0 ? (
		<Flex mt={6} align="center" justify="space-between">
			<Text size="sm">Total {props.stat}</Text>
			<Text size="sm">{props.val}</Text>
		</Flex>
	) : null;
};
