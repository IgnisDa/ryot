import type { NextPageWithLayout } from "./_app";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Alert,
	Box,
	Button,
	Container,
	Loader,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { RegerateUserSummaryMutationVariables } from "@trackona/generated/graphql/backend/graphql";
import { REGENERATE_USER_SUMMARY } from "@trackona/graphql/backend/mutations";
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
		{ staleTime: Infinity, retry: false },
	);
	const regenerateUserSummary = useMutation({
		mutationFn: async (variables: RegerateUserSummaryMutationVariables) => {
			const { regenerateUserSummary } = await gqlClient.request(
				REGENERATE_USER_SUMMARY,
				variables,
			);
			return regenerateUserSummary;
		},
		onSuccess: () => {
			userSummary.refetch();
		},
	});

	return (
		<Container>
			<Stack>
				<Title>Your summary</Title>
				{userSummary.isLoading ? <Loader /> : null}
				{userSummary.isError ? (
					<Alert color='yellow' icon={<IconAlertCircle size="1rem" />}>
						You have not generated any summaries yet. Click below to generate
						one.
					</Alert>
				) : null}
				{userSummary.data ? (
					<SimpleGrid
						cols={1}
						spacing="lg"
						breakpoints={[{ minWidth: "sm", cols: 2 }]}
					>
						<Box>
							<StatTitle text="Books" />
							<Text>
								You read <StatNumber text={userSummary.data.books.read} />{" "}
								book(s) totalling{" "}
								<StatNumber text={userSummary.data.books.pages} /> page(s).
							</Text>
						</Box>
						<Box>
							<StatTitle text="Movies" />
							<Text>
								You watched{" "}
								<StatNumber text={userSummary.data.movies.watched} /> movie(s)
								totalling <StatNumber text={userSummary.data.movies.runtime} />{" "}
								minute(s).
							</Text>
						</Box>
						<Box>
							<StatTitle text="Shows" />
							<Text>
								You watched{" "}
								<StatNumber text={userSummary.data.shows.watchedShows} />{" "}
								show(s) and{" "}
								<StatNumber text={userSummary.data.shows.watchedEpisodes} />{" "}
								episode(s) totalling{" "}
								<StatNumber text={userSummary.data.shows.runtime} /> minute(s).
							</Text>
						</Box>
						<Box>
							<StatTitle text="Video Games" />
							<Text>
								You played{" "}
								<StatNumber text={userSummary.data.videoGames.played} />{" "}
								game(s).
							</Text>
						</Box>
						<Box>
							<StatTitle text="Audio Books" />
							<Text>
								You listened to{" "}
								<StatNumber text={userSummary.data.audioBooks.played} />{" "}
								audiobook(s) totalling{" "}
								<StatNumber text={userSummary.data.audioBooks.runtime} />{" "}
								minute(s).
							</Text>
						</Box>
					</SimpleGrid>
				) : null}
				<Box>
					<Button
						style={{ flexGrow: 0 }}
						variant="light"
						onClick={() => regenerateUserSummary.mutate({})}
						loading={regenerateUserSummary.isLoading}
					>
						Recalculate
					</Button>
				</Box>
			</Stack>
		</Container>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
