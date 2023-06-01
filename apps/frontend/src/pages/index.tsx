import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getMetadataIcon, getStringAsciiValue } from "@/lib/utilities";
import {
	Box,
	Center,
	Container,
	Divider,
	Flex,
	Paper,
	RingProgress,
	SimpleGrid,
	Stack,
	Text,
	Title,
	useMantineTheme,
} from "@mantine/core";
import {
	CollectionsDocument,
	MetadataLot,
	UserSummaryDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import humanFormat from "human-format";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import Head from "next/head";
import { type ReactElement } from "react";

const service = new HumanizeDurationLanguage();
const humaizer = new HumanizeDuration(service);

const DisplayStatForMediaType = (props: {
	lot: MetadataLot;
	data: { type: "duration" | "number"; label: string; value: number }[];
}) => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size="1.5rem" stroke={1.5} />;
	return (
		<Paper component={Flex} align={"center"}>
			<RingProgress
				size={60}
				thickness={4}
				sections={[]}
				label={<Center>{icon}</Center>}
				rootColor={
					colors[
						(getStringAsciiValue(props.lot) + colors.length) % colors.length
					]
				}
			/>
			<Flex wrap={"wrap"} ml="xs">
				{props.data.map((d, idx) => (
					<Box key={idx.toString()} mx={"xs"}>
						<Text
							fw={d.label !== "Runtime" ? "bold" : undefined}
							display={"inline"}
						>
							{d.type === "duration"
								? humaizer.humanize(d.value * 1000 * 60)
								: humanFormat(d.value)}
						</Text>
						<Text display={"inline"} ml="4px">
							{d.label === "Runtime" ? "" : d.label}
						</Text>
					</Box>
				))}
			</Flex>
		</Paper>
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

	const inProgressCollection = collections.data?.find(
		(c) => c.collectionDetails.name === "In Progress",
	);

	return collections.data && userSummary.data ? (
		<>
			<Head>
				<title>Dashboard | Ryot</title>
			</Head>
			<Container>
				<Stack>
					{inProgressCollection &&
					inProgressCollection.mediaDetails.length > 0 ? (
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
						cols={1}
						spacing="lg"
						breakpoints={[
							{ minWidth: "sm", cols: 2 },
							{ minWidth: "md", cols: 3 },
						]}
					>
						<DisplayStatForMediaType
							lot={MetadataLot.Movie}
							data={[
								{
									label: "Movies",
									value: userSummary.data.movies.watched,
									type: "number",
								},
								{
									label: "Runtime",
									value: userSummary.data.movies.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Show}
							data={[
								{
									label: "Shows",
									value: userSummary.data.shows.watched,
									type: "number",
								},
								{
									label: "Seasons",
									value: userSummary.data.shows.watchedSeasons,
									type: "number",
								},
								{
									label: "Episodes",
									value: userSummary.data.shows.watchedEpisodes,
									type: "number",
								},
								{
									label: "Runtime",
									value: userSummary.data.shows.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.VideoGame}
							data={[
								{
									label: "Video games",
									value: userSummary.data.videoGames.played,
									type: "number",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.AudioBook}
							data={[
								{
									label: "Audiobooks",
									value: userSummary.data.audioBooks.played,
									type: "number",
								},
								{
									label: "Runtime",
									value: userSummary.data.audioBooks.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Book}
							data={[
								{
									label: "Books",
									value: userSummary.data.books.read,
									type: "number",
								},
								{
									label: "Pages",
									value: userSummary.data.books.pages,
									type: "number",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Podcast}
							data={[
								{
									label: "Podcasts",
									value: userSummary.data.podcasts.played,
									type: "number",
								},
								{
									label: "Episodes",
									value: userSummary.data.podcasts.playedEpisodes,
									type: "number",
								},
								{
									label: "Runtime",
									value: userSummary.data.podcasts.runtime,
									type: "duration",
								},
							]}
						/>
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
