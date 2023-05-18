import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Container,
	Loader,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	MediaInProgressDocument,
	UserSummaryDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import humanFormat from "human-format";
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
				: humanFormat(props.text)}
		</Text>
	);
};

const Page: NextPageWithLayout = () => {
	const mediaInProgress = useQuery(["mediaInProgress"], async () => {
		const { mediaInProgress } = await gqlClient.request(
			MediaInProgressDocument,
		);
		return mediaInProgress;
	});
	const userSummary = useQuery(
		["userSummary"],
		async () => {
			const { userSummary } = await gqlClient.request(UserSummaryDocument);
			return userSummary;
		},
		{ retry: false },
	);

	return mediaInProgress.data && userSummary.data ? (
		<Container>
			<Stack>
				{mediaInProgress.data.length > 0 ? (
					<>
						<Title>In Progress</Title>
						<Grid>
							{mediaInProgress.data.map((lm) => (
								<MediaItemWithoutUpdateModal
									key={lm.identifier}
									item={lm}
									lot={lm.lot}
									imageOnClick={async () => parseInt(lm.identifier)}
								/>
							))}
						</Grid>
					</>
				) : null}
				<Title>Summary</Title>
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
							<StatNumber text={userSummary.data.movies.runtime} isDuration />.
						</Text>
					</Box>
					<Box>
						<StatTitle text="Shows" />
						<Text>
							You watched{" "}
							<StatNumber text={userSummary.data.shows.watchedShows} /> show(s)
							and <StatNumber text={userSummary.data.shows.watchedEpisodes} />{" "}
							episode(s) totalling{" "}
							<StatNumber text={userSummary.data.shows.runtime} isDuration />.
						</Text>
					</Box>
					<Box>
						<StatTitle text="Video Games" />
						<Text>
							You played{" "}
							<StatNumber text={userSummary.data.videoGames.played} /> game(s).
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
					<Box>
						<StatTitle text="Podcasts" />
						<Text>
							You listened to{" "}
							<StatNumber text={userSummary.data.podcasts.watched} /> podcast(s)
							totalling{" "}
							<StatNumber text={userSummary.data.podcasts.runtime} isDuration />
							.
						</Text>
					</Box>
				</SimpleGrid>
			</Stack>
		</Container>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
