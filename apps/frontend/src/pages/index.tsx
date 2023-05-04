import type { NextPageWithLayout } from "./_app";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Box, Container, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { USER_SUMMARY } from "@trackona/graphql/backend/queries";
import type { ReactElement } from "react";

const StatTitle = (props: { text: string }) => {
	return <Title order={3}>{props.text}</Title>;
};

const StatNumber = (props: { text: number }) => {
	return (
		<Text fw="bold" style={{ display: "inline" }}>
			{props.text}
		</Text>
	);
};

const Page: NextPageWithLayout = () => {
	const userSummary = useQuery(
		["userSummary"],
		async () => {
			const { userSummary } = await gqlClient.request(USER_SUMMARY);
			return userSummary;
		},
		{ staleTime: Infinity },
	);

	return userSummary.data ? (
		<Container>
			<Stack>
				<SimpleGrid
					cols={1}
					spacing="lg"
					mx={"lg"}
					breakpoints={[{ minWidth: "sm", cols: 2 }]}
				>
					<Box>
						<StatTitle text="Books" />
						<Text>
							You read <StatNumber text={userSummary.data.books.read} /> book(s)
							totalling <StatNumber text={userSummary.data.books.pages} />{" "}
							page(s).
						</Text>
					</Box>
					<Box>
						<StatTitle text="Movies" />
						<Text>
							You watched <StatNumber text={userSummary.data.movies.watched} />{" "}
							movie(s) totalling{" "}
							<StatNumber text={userSummary.data.movies.runtime} /> minute(s).
						</Text>
					</Box>
					<Box>
						<StatTitle text="Shows" />
						<Text>
							You watched{" "}
							<StatNumber text={userSummary.data.shows.watchedShows} /> show(s)
							and <StatNumber text={userSummary.data.shows.watchedEpisodes} />{" "}
							episode(s) totalling{" "}
							<StatNumber text={userSummary.data.shows.runtime} /> minute(s).
						</Text>
					</Box>
					<Box>
						<StatTitle text="Video Games" />
						<Text>
							You played{" "}
							<StatNumber text={userSummary.data.videoGames.played} /> game(s).
						</Text>
					</Box>
				</SimpleGrid>
			</Stack>
		</Container>
	) : null;
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
