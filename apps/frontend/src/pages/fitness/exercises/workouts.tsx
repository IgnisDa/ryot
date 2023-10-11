import { getSetStatisticsTextToDisplay } from "@/lib/components/FitnessComponents";
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Accordion,
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
import { useLocalStorage } from "@mantine/hooks";
import {
	UserWorkoutListDocument,
	type UserWorkoutListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { IconClock, IconTrophy, IconWeight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "../../_app";

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
				<title>Workouts | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Workouts</Title>
					{userWorkoutList.data.items.length > 0 ? (
						<>
							<Box>
								<Text display="inline" fw="bold">
									{userWorkoutList.data.details.total}{" "}
								</Text>
								workouts
							</Box>
							<Accordion>
								{userWorkoutList.data.items.map((workout) => (
									<Accordion.Item key={workout.id} value={workout.id}>
										<Accordion.Control>
											<Text>{workout.name}</Text>
											<Text size="sm" c="dimmed">
												{DateTime.fromJSDate(workout.startTime).toLocaleString({
													month: "long",
													day: "numeric",
												})}
											</Text>
											<Group mt="xs" gap="lg">
												<DisplayStat
													icon={<IconClock size="1rem" />}
													data={`${DateTime.fromJSDate(workout.endTime)
														.diff(
															DateTime.fromJSDate(workout.startTime),
															"minutes",
														)
														.minutes.toFixed()} minutes`}
												/>
												<DisplayStat
													icon={<IconWeight size="1rem" />}
													data={new Intl.NumberFormat("en-us", {
														style: "unit",
														unit: "kilogram",
													}).format(Number(workout.summary.total.weight))}
												/>
												<DisplayStat
													icon={<IconTrophy size="1rem" />}
													data={workout.summary.total.personalBestsAchieved.toString()}
												/>
											</Group>
										</Accordion.Control>
										<Accordion.Panel>
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
