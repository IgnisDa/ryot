import { getSetStatisticsTextToDisplay } from "@/lib/components/FitnessComponents";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Accordion,
	Anchor,
	Center,
	Container,
	Flex,
	Group,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
	UserWorkoutListDocument,
	type UserWorkoutListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { IconClock, IconTrophy, IconWeight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import { DateTime } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { type ReactElement } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../../_app";

const service = new HumanizeDurationLanguage();
const humanizer = new HumanizeDuration(service);

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
	const [stat, _] = getSetStatisticsTextToDisplay(
		props.exercise.lot,
		props.exercise.bestSet.statistic,
	);

	return (
		<Flex gap="xs">
			<Text fz="sm" ff="monospace">
				{props.exercise.numSets} ×
			</Text>
			<Text style={{ flex: 1 }} fz="sm">
				{props.exercise.name}
			</Text>
			<Text fz="sm">{stat}</Text>
		</Flex>
	);
};

const Page: NextPageWithLayout = () => {
	const [activePage, setPage] = useLocalStorage({
		defaultValue: "1",
		key: LOCAL_STORAGE_KEYS.savedWorkoutListPage,
		getInitialValueInEffect: false,
	});
	const coreDetails = useCoreDetails();

	const userWorkoutList = useQuery(
		["userWorkoutList", activePage],
		async () => {
			const { userWorkoutList } = await gqlClient.request(
				UserWorkoutListDocument,
				{ page: parseInt(activePage || "1") },
			);
			return userWorkoutList;
		},
	);

	return coreDetails.data && userWorkoutList.data ? (
		<>
			<Head>
				<title>Your Workouts | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Workouts</Title>
					{userWorkoutList.data.items.length > 0 ? (
						<>
							<Accordion multiple chevronPosition="left">
								{userWorkoutList.data.items.map((workout) => (
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
														{DateTime.fromJSDate(
															workout.startTime,
														).toLocaleString({
															month: "long",
															year: "numeric",
															day: "numeric",
														})}
													</Text>
												</Group>
												<Group mt="xs" gap="lg">
													<DisplayStat
														icon={<IconClock size={16} />}
														data={humanizer.humanize(
															workout.endTime.getTime() -
																workout.startTime.getTime(),
															{ round: true },
														)}
													/>
													<DisplayStat
														icon={<IconWeight size={16} />}
														data={new Intl.NumberFormat("en-us", {
															style: "unit",
															unit: "kilogram",
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
												href={withQuery(APP_ROUTES.fitness.workoutDetails, {
													id: workout.id,
												})}
												fz="xs"
												ta="right"
												pr="md"
											>
												View details
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
															key={`${idx}-${exercise.name}`}
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
					{userWorkoutList.data ? (
						<Center>
							<Pagination
								size="sm"
								value={parseInt(activePage || "1")}
								onChange={(v) => setPage(v.toString())}
								total={Math.ceil(
									userWorkoutList.data.details.total /
										coreDetails.data.pageLimit,
								)}
								boundaries={1}
								siblings={0}
							/>
						</Center>
					) : undefined}
				</Stack>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
