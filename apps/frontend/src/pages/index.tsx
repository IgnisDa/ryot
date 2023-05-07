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
import {
	RegerateUserSummaryDocument,
	type RegerateUserSummaryMutationVariables,
	UserSummaryDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import type { ReactElement } from "react";

const service = new HumanizeDurationLanguage();
const humaizer = new HumanizeDuration(service);

const StatTitle = (props: { text: string }) => {
	return <Title order={5}>{props.text}</Title>;
};

const StatNumber = (props: { text: number; isDuration?: boolean }) => {
	return (
		<Text fw="bold" style={{ display: "inline" }}>
			{props.isDuration
				? humaizer.humanize(props.text * 1000 * 60)
				: props.text}
		</Text>
	);
};

const Page: NextPageWithLayout = () => {
	const userSummary = useQuery(
		["userSummary"],
		async () => {
			const { userSummary } = await gqlClient.request(UserSummaryDocument);
			return userSummary;
		},
		{ retry: false },
	);
	const regenerateUserSummary = useMutation({
		mutationFn: async (variables: RegerateUserSummaryMutationVariables) => {
			const { regenerateUserSummary } = await gqlClient.request(
				RegerateUserSummaryDocument,
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
				{userSummary.isLoading ? <Loader /> : null}
				{userSummary.isError ? (
					<Alert color="yellow" icon={<IconAlertCircle size="1rem" />}>
						You have not generated any summaries yet. Click below to generate
						one.
					</Alert>
				) : null}
				{userSummary.data ? (
					<SimpleGrid
						cols={2}
						spacing="lg"
						breakpoints={[
							{ minWidth: "sm", cols: 3 },
							{ minWidth: "lg", cols: 4 },
						]}
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
								totalling{" "}
								<StatNumber text={userSummary.data.movies.runtime} isDuration />
								.
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
								<StatNumber text={userSummary.data.shows.runtime} isDuration />.
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
								<StatNumber
									text={userSummary.data.audioBooks.runtime}
									isDuration
								/>
								.
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
