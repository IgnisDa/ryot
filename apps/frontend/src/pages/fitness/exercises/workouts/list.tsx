import { getSetStatisticsTextToDisplay } from "@/components/FitnessComponents";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
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
	TextInput,
	Title,
} from "@mantine/core";
import { useDebouncedState, useLocalStorage } from "@mantine/hooks";
import {
	UserWorkoutListDocument,
	type UserWorkoutListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconClock,
	IconLink,
	IconSearch,
	IconTrophy,
	IconWeight,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { DateTime, Duration } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useEffect, type ReactElement } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../../_app";

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
		defaultValue: 1,
		key: LOCAL_STORAGE_KEYS.savedWorkoutListPage,
		getInitialValueInEffect: false,
	});
	const [query, setQuery] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedWorkoutListQuery,
		getInitialValueInEffect: false,
	});
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);
	const coreDetails = useCoreDetails();

	const userWorkoutList = useQuery({
		queryKey: ["userWorkoutList", activePage, debouncedQuery],
		queryFn: async () => {
			const { userWorkoutList } = await gqlClient.request(
				UserWorkoutListDocument,
				{ input: { page: activePage || 1, query: debouncedQuery } },
			);
			return userWorkoutList;
		},
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim() || "");
	}, [query]);

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size={16} />
			</ActionIcon>
		) : undefined;

	return coreDetails.data ? (
		<>
			<Head>
				<title>Your Workouts | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Workouts</Title>
					<TextInput
						name="query"
						placeholder="Search for workouts"
						leftSection={<IconSearch />}
						onChange={(e) => setQuery(e.currentTarget.value)}
						value={query}
						rightSection={<ClearButton />}
						style={{ flexGrow: 1 }}
						autoCapitalize="none"
						autoComplete="off"
					/>
					{userWorkoutList.data && userWorkoutList.data.items.length > 0 ? (
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
														data={((dur: number) => {
															let format = "";
															if (dur > 3600000) format += "h'h', ";
															format += "m'm'";
															return Duration.fromMillis(dur).toFormat(format);
														})(
															workout.endTime.getTime() -
																workout.startTime.getTime(),
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
								value={activePage || 1}
								onChange={(v) => setPage(v)}
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
