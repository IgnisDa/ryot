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
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	UserUnitSystem,
	UserWorkoutListDocument,
	UserWorkoutListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconClock,
	IconLink,
	IconSearch,
	IconTrophy,
	IconWeight,
	IconX,
} from "@tabler/icons-react";
import { DateTime, Duration } from "luxon";
import { ReactElement, useEffect, useState } from "react";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationPagination } from "~/components/common";
import { getSetStatisticsTextToDisplay } from "~/components/fitness";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

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
			getCoreDetails(),
			gqlClient.request(
				UserWorkoutListDocument,
				{
					input: { page: query.page, query: query.query },
				},
				await getAuthorizationHeader(request),
			),
		],
	);
	return json({ userPreferences, coreDetails, query, userWorkoutList });
};

export const meta: MetaFunction = () => {
	return [{ title: "Workouts | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [searchParams, { setP }] = useSearchParam();
	const [query, setQuery] = useState(searchParams.get("query") || "");

	useEffect(() => setP("query", query), [query]);

	return (
		<Container size="xs">
			<Stack>
				<Title>Workouts</Title>
				<TextInput
					name="query"
					placeholder="Search for workouts"
					leftSection={<IconSearch />}
					onChange={(e) => setQuery(e.currentTarget.value)}
					value={query}
					rightSection={
						query ? (
							<ActionIcon onClick={() => setQuery("")}>
								<IconX size={16} />
							</ActionIcon>
						) : undefined
					}
					style={{ flexGrow: 1 }}
					autoCapitalize="none"
					autoComplete="off"
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
													{DateTime.fromISO(workout.startTime).toLocaleString({
														month: "long",
														year: "numeric",
														day: "numeric",
													})}
												</Text>
											</Group>
											<Group mt="xs" gap="lg">
												<DisplayStat
													icon={<IconClock size={16} />}
													data={((dur: number) => {
														let format = "";
														if (dur > 3600000) format += "h'h', ";
														format += "m'm'";
														return Duration.fromMillis(dur).toFormat(format);
													})(
														new Date(workout.endTime).getTime() -
															new Date(workout.startTime).getTime(),
													)}
												/>
												<DisplayStat
													icon={<IconWeight size={16} />}
													data={new Intl.NumberFormat("en-us", {
														style: "unit",
														unit:
															loaderData.userPreferences.fitness.exercises
																.unitSystem === UserUnitSystem.Imperial
																? "pound"
																: "kilogram",
													}).format(Number(workout.summary.total.weight))}
												/>
												<DisplayStat
													icon={<IconTrophy size={16} />}
													data={`${workout.summary.total.personalBestsAchieved.toString()} PRs`}
												/>
											</Group>
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
														unit={
															loaderData.userPreferences.fitness.exercises
																.unitSystem
														}
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
					<ApplicationPagination
						size="sm"
						defaultValue={loaderData.query.page}
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
