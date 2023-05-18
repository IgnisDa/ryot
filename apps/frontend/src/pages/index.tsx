import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Button,
	Container,
	Divider,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	CollectionsDocument,
	UserSummaryDocument,
	type RemoveMediaFromCollectionMutationVariables,
	RemoveMediaFromCollectionDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
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
	const userSummary = useQuery(
		["userSummary"],
		async () => {
			const { userSummary } = await gqlClient.request(UserSummaryDocument);
			return userSummary;
		},
		{ retry: false },
	);
	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(CollectionsDocument);
		return collections;
	});
	const removeMediaFromCollection = useMutation({
		mutationFn: async (
			variables: RemoveMediaFromCollectionMutationVariables,
		) => {
			const { removeMediaFromCollection } = await gqlClient.request(
				RemoveMediaFromCollectionDocument,
				variables,
			);
			return removeMediaFromCollection;
		},
		onSuccess: () => {
			collections.refetch();
		},
	});

	const inProgressCollection = collections.data?.find(
		(c) => c.collectionDetails.name === "In Progress",
	);

	return collections.data && userSummary.data ? (
		<Container>
			<Stack>
				{inProgressCollection ? (
					<>
						<Title>In Progress</Title>
						<Grid>
							{inProgressCollection.mediaDetails.map((lm) => (
								<MediaItemWithoutUpdateModal
									key={lm.identifier}
									item={lm}
									lot={lm.lot}
									imageOnClick={async () => parseInt(lm.identifier)}
								/>
							))}
						</Grid>
						<Divider />
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
				<Divider />
				<Title>Your Collections</Title>
				{collections.data &&
					collections.data.map((collection) => (
						<Stack key={collection.collectionDetails.id}>
							<Title order={3} truncate>
								{collection.collectionDetails.name}
							</Title>
							{collection.mediaDetails.length > 0 ? (
								<Grid>
									{collection.mediaDetails.map((mediaItem) => (
										<MediaItemWithoutUpdateModal
											key={mediaItem.identifier}
											item={mediaItem}
											lot={mediaItem.lot}
											imageOnClick={async () => parseInt(mediaItem.identifier)}
										>
											<Button
												fullWidth
												color="red"
												variant="outline"
												onClick={() => {
													removeMediaFromCollection.mutate({
														collectionName: collection.collectionDetails.name,
														metadataId: Number(mediaItem.identifier),
													});
												}}
											>
												Remove
											</Button>
										</MediaItemWithoutUpdateModal>
									))}
								</Grid>
							) : (
								<Text>No items in this collection</Text>
							)}
						</Stack>
					))}
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
