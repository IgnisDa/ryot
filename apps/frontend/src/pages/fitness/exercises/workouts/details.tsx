import { getSetStatisticsTextToDisplay } from "@/lib/components/FitnessComponents";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Box, Container, Flex, Stack, Text } from "@mantine/core";
import {
	WorkoutDetailsDocument,
	type UserWorkoutListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "../../../_app";
import { useRouter } from "next/router";
import invariant from "tiny-invariant";

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
	const router = useRouter();
	const workoutId = router.query.id?.toString();

	const workoutDetails = useQuery(["workoutDetails"], async () => {
		invariant(workoutId);
		const { workoutDetails } = await gqlClient.request(WorkoutDetailsDocument, {
			workoutId,
		});
		return workoutDetails;
	});

	return workoutDetails.data ? (
		<>
			<Head>
				<title>{workoutDetails.data.name} | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Box>{JSON.stringify(workoutDetails.data)}</Box>
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
