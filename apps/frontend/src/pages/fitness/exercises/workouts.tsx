import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Center,
	Container,
	Flex,
	Pagination,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { UserWorkoutListDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const [activePage, setPage] = useLocalStorage({
		defaultValue: "1",
		key: "savedWorkoutListPage",
		getInitialValueInEffect: false,
	});
	const coreDetails = useCoreDetails();

	const userWorkoutList = useQuery(["userWorkoutList"], async () => {
		const { userWorkoutList } = await gqlClient.request(
			UserWorkoutListDocument,
			{ page: parseInt(activePage || "1") },
		);
		return userWorkoutList;
	});

	return coreDetails.data && userWorkoutList.data ? (
		<>
			<Head>
				<title>Workouts | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Title>Workouts</Title>
					{userWorkoutList.data.items.length > 0 ? (
						<SimpleGrid cols={{ base: 1, md: 2 }}>
							{userWorkoutList.data.items.map((workout) => (
								<Flex
									key={workout.id}
									align="center"
									justify="space-between"
									gap="md"
									mr="lg"
								>
									{JSON.stringify(workout, null, 2)}
								</Flex>
							))}
						</SimpleGrid>
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
