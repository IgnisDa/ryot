import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Accordion,
	Box,
	Center,
	Container,
	Pagination,
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
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";

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
								items found
							</Box>
							<Accordion>
								{userWorkoutList.data.items.map((workout) => (
									<Accordion.Item key={workout.id} value={workout.id}>
										<Accordion.Control>{workout.name}</Accordion.Control>
										<Accordion.Panel>
											{JSON.stringify(workout, null, 2)}
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
