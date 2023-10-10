import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Container, Flex, SimpleGrid, Stack, Title } from "@mantine/core";
import { UserWorkoutListDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const userWorkoutList = useQuery(["userWorkoutList"], async () => {
		const { userWorkoutList } = await gqlClient.request(
			UserWorkoutListDocument,
			{ page: 1 },
		);
		return userWorkoutList;
	});

	return userWorkoutList.data ? (
		<>
			<Head>
				<title>Workouts | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Title>Workouts</Title>
					<SimpleGrid cols={{ base: 1, md: 2 }}>
						{userWorkoutList.data.items.map((workout) => (
							<Flex
								key={workout.id}
								align="center"
								justify="space-between"
								gap="md"
								mr="lg"
							>
								{JSON.stringify(workout)}
							</Flex>
						))}
					</SimpleGrid>
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
