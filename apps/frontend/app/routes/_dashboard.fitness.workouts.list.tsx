import { $path } from "@ignisda/remix-routes";
import {
	Accordion,
	ActionIcon,
	Anchor,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	type UserUnitSystem,
	UserWorkoutListDocument,
	type UserWorkoutListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { displayWeightWithUnit, humanizeDuration } from "@ryot/ts-utils";
import {
	IconClock,
	IconLink,
	IconPlus,
	IconTrophy,
	IconWeight,
} from "@tabler/icons-react";
import type { ReactElement } from "react";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput } from "~/components/common";
import { getSetStatisticsTextToDisplay } from "~/components/fitness";
import { dayjsLib } from "~/lib/generals";
import { getWorkoutStarter, useSearchParam } from "~/lib/hooks";
import {
	getAuthorizationHeader,
	getCoreDetails,
	getUserPreferences,
	gqlClient,
} from "~/lib/utilities.server";
import { getDefaultWorkout } from "~/lib/workout";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [userPreferences, coreDetails, { userWorkoutList }] = await Promise.all(
		[
			getUserPreferences(request),
			getCoreDetails(request),
			gqlClient.request(
				UserWorkoutListDocument,
				{
					input: { page: query.page, query: query.query },
				},
				await getAuthorizationHeader(request),
			),
		],
	);
	return json({
		userPreferences: {
			unitSystem: userPreferences.fitness.exercises.unitSystem,
		},
		coreDetails: { pageLimit: coreDetails.pageLimit },
		query,
		userWorkoutList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Workouts | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useSearchParam();
	const startWorkout = getWorkoutStarter();

	return (
		<Container size="xs">
			<Stack>
				<Flex align="center" gap="md">
					<Title>Workouts</Title>
					<ActionIcon
						color="green"
						variant="outline"
						onClick={() => {
							startWorkout(getDefaultWorkout());
						}}
					>
						<IconPlus size={16} />
					</ActionIcon>
				</Flex>
				<DebouncedSearchInput
					placeholder="Search for workouts"
					initialValue={loaderData.query.query}
				/>
				{loaderData.userWorkoutList.items.length > 0 ? (
					<>
						<Accordion multiple chevronPosition="left">
							{loaderData.userWorkoutList.items.map((workout) => (
								<Accordion.Item
									key={workout.id}
									value={workout.id}
									data-workout-id={workout.id}
								>
									<Center>
										<Accordion.Control>
											<Group wrap="nowrap">
												<Text fz={{ base: "sm", md: "md" }}>
													{workout.name}
												</Text>
												<Text fz={{ base: "xs", md: "sm" }} c="dimmed">
													{dayjsLib(workout.startTime).format("LL")}
												</Text>
											</Group>
											<Stack mt="xs" gap={1}>
												<DisplayStat
													icon={<IconClock size={16} />}
													data={humanizeDuration(
														new Date(workout.endTime).valueOf() -
															new Date(workout.startTime).valueOf(),
														{ round: true, units: ["h", "m"] },
													)}
												/>
												<Group>
													<DisplayStat
														icon={<IconWeight size={16} />}
														data={displayWeightWithUnit(
															loaderData.userPreferences.unitSystem,
															workout.summary.total.weight,
														)}
													/>
													{Number(
														workout.summary.total.personalBestsAchieved,
													) !== 0 ? (
														<DisplayStat
															icon={<IconTrophy size={16} />}
															data={`${workout.summary.total.personalBestsAchieved} PRs`}
														/>
													) : null}
												</Group>
											</Stack>
										</Accordion.Control>
										<Anchor
											component={Link}
											to={$path("/fitness/workouts/:id", { id: workout.id })}
											pr="md"
										>
											<Text fz="xs" ta="right" visibleFrom="sm">
												View details
											</Text>
											<Box hiddenFrom="sm">
												<IconLink size={16} />
											</Box>
										</Anchor>
									</Center>
									<Accordion.Panel>
										{workout.summary.exercises.length > 0 ? (
											<>
												<Group justify="space-between">
													<Text fw="bold">Exercise</Text>
													<Text fw="bold">Best set</Text>
												</Group>
												{workout.summary.exercises.map((exercise, idx) => (
													<ExerciseDisplay
														exercise={exercise}
														key={`${idx}-${exercise.id}`}
														unit={loaderData.userPreferences.unitSystem}
													/>
												))}
											</>
										) : (
											<Text>No exercises done</Text>
										)}
									</Accordion.Panel>
								</Accordion.Item>
							))}
						</Accordion>
					</>
				) : (
					<Text>No workouts found</Text>
				)}
				<Center>
					<Pagination
						size="sm"
						value={loaderData.query.page}
						onChange={(v) => setP("page", v.toString())}
						total={Math.ceil(
							loaderData.userWorkoutList.details.total /
								loaderData.coreDetails.pageLimit,
						)}
					/>
				</Center>
			</Stack>
		</Container>
	);
}

const DisplayStat = (props: {
	icon: ReactElement;
	data: string;
}) => {
	return (
		<Flex gap={4} align="center">
			{props.icon}
			<Text size="sm" span>
				{props.data}
			</Text>
		</Flex>
	);
};

const ExerciseDisplay = (props: {
	exercise: UserWorkoutListQuery["userWorkoutList"]["items"][number]["summary"]["exercises"][number];
	unit: UserUnitSystem;
}) => {
	const [stat, _] = getSetStatisticsTextToDisplay(
		props.exercise.lot,
		props.exercise.bestSet.statistic,
		props.unit,
	);

	return (
		<Flex gap="xs">
			<Text fz="sm" ff="monospace">
				{props.exercise.numSets} ×
			</Text>
			<Text style={{ flex: 1 }} fz="sm">
				{props.exercise.id}
			</Text>
			<Text fz="sm">{stat}</Text>
		</Flex>
	);
};
