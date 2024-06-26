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
import { unstable_defineLoader } from "@remix-run/node";
import {
	Link,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import {
	UserWorkoutListDocument,
	type UserWorkoutListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	displayWeightWithUnit,
	humanizeDuration,
	truncate,
} from "@ryot/ts-utils";
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
import {
	getWorkoutStarter,
	useCoreDetails,
	useSearchParam,
	useUserPreferences,
} from "~/lib/hooks";
import { getDefaultWorkout } from "~/lib/state/workout";
import {
	getAuthorizationHeader,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ userWorkoutList }] = await Promise.all([
		serverGqlService.request(
			UserWorkoutListDocument,
			{ input: { page: query.page, query: query.query } },
			getAuthorizationHeader(request),
		),
	]);
	return { query, userWorkoutList };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Workouts | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useSearchParam();
	const startWorkout = getWorkoutStarter();
	const unitSystem = userPreferences.fitness.exercises.unitSystem;

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
													{truncate(workout.name, { length: 20 })}
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
															unitSystem,
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
							loaderData.userWorkoutList.details.total / coreDetails.pageLimit,
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
}) => {
	const userPreferences = useUserPreferences();
	const [stat, _] = getSetStatisticsTextToDisplay(
		props.exercise.lot,
		props.exercise.bestSet.statistic,
		userPreferences.fitness.exercises.unitSystem,
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
