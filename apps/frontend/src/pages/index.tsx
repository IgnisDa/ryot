import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import { ROUTES } from "@/lib/constants";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLot, getMetadataIcon, getStringAsciiValue } from "@/lib/utilities";
import {
	Box,
	Button,
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
import { notifications } from "@mantine/notifications";
import {
	CollectionsDocument,
	CreateCollectionDocument,
	type CreateCollectionMutationVariables,
	MetadataLot,
	UserSummaryDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconList, IconPhotoPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import humanFormat from "human-format";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import Head from "next/head";
import Link from "next/link";
import { type ReactElement } from "react";

const service = new HumanizeDurationLanguage();
const humaizer = new HumanizeDuration(service);

const DisplayStatForMediaType = (props: {
	lot: MetadataLot;
	data: { type: "duration" | "number"; label: string; value: number }[];
}) => {
	const userPrefs = useUserPreferences();
	const isEnabled = Object.entries(userPrefs.data?.featuresEnabled || {}).find(
		([name, _]) => getLot(name) === props.lot,
	)!;
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size="1.5rem" stroke={1.5} />;
	return isEnabled ? (
		isEnabled[1] ? (
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
									? humaizer.humanize(d.value * 1000 * 60, {
											round: true,
											largest: 3,
									  })
									: humanFormat(d.value)}
							</Text>
							<Text display={"inline"} ml="4px">
								{d.label === "Runtime" ? "" : d.label}
							</Text>
						</Box>
					))}
				</Flex>
			</Paper>
		) : null
	) : null;
};

const Page: NextPageWithLayout = () => {
	const service = new HumanizeDurationLanguage();
	const humaizer = new HumanizeDuration(service);
	const userSummary = useQuery(
		["userSummary"],
		async () => {
			const { userSummary } = await gqlClient.request(UserSummaryDocument);
			return userSummary;
		},
		{ retry: false },
	);
	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(CollectionsDocument, {
			limit: 8,
		});
		return collections;
	});
	const createCollection = useMutation({
		mutationFn: async (variables: CreateCollectionMutationVariables) => {
			const { createCollection } = await gqlClient.request(
				CreateCollectionDocument,
				variables,
			);
			return createCollection;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Collection created successfully",
				color: "green",
			});
		},
	});

	const inProgressCollection = (collections.data || [])?.find(
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
							<Grid listType="poster">
								{inProgressCollection.mediaDetails.map((lm) => (
									<MediaItemWithoutUpdateModal
										listType="poster"
										key={lm.identifier}
										item={lm}
										lot={lm.lot}
										href={`${ROUTES.media.details}?item=${lm.identifier}`}
									/>
								))}
							</Grid>
							<Divider />
						</>
					) : null}
					<Title>Summary</Title>
					<Text size="xs" mt={-15}>
						Calculated on{" "}
						{humaizer.humanize(
							new Date().getTime() - userSummary.data.calculatedOn.getTime(),
							{ units: ["h", "m"], round: true },
						)}{" "}
						ago
					</Text>
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
									value: userSummary.data.media.movies.watched,
									type: "number",
								},
								{
									label: "Runtime",
									value: userSummary.data.media.movies.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Show}
							data={[
								{
									label: "Shows",
									value: userSummary.data.media.shows.watched,
									type: "number",
								},
								{
									label: "Seasons",
									value: userSummary.data.media.shows.watchedSeasons,
									type: "number",
								},
								{
									label: "Episodes",
									value: userSummary.data.media.shows.watchedEpisodes,
									type: "number",
								},
								{
									label: "Runtime",
									value: userSummary.data.media.shows.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.VideoGame}
							data={[
								{
									label: "Video games",
									value: userSummary.data.media.videoGames.played,
									type: "number",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.AudioBook}
							data={[
								{
									label: "Audiobooks",
									value: userSummary.data.media.audioBooks.played,
									type: "number",
								},
								{
									label: "Runtime",
									value: userSummary.data.media.audioBooks.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Book}
							data={[
								{
									label: "Books",
									value: userSummary.data.media.books.read,
									type: "number",
								},
								{
									label: "Pages",
									value: userSummary.data.media.books.pages,
									type: "number",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Podcast}
							data={[
								{
									label: "Podcasts",
									value: userSummary.data.media.podcasts.played,
									type: "number",
								},
								{
									label: "Episodes",
									value: userSummary.data.media.podcasts.playedEpisodes,
									type: "number",
								},
								{
									label: "Runtime",
									value: userSummary.data.media.podcasts.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Manga}
							data={[
								{
									label: "Manga",
									value: userSummary.data.media.manga.read,
									type: "number",
								},
								{
									label: "Chapters",
									value: userSummary.data.media.manga.chapters,
									type: "number",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Anime}
							data={[
								{
									label: "Anime",
									value: userSummary.data.media.anime.watched,
									type: "number",
								},
								{
									label: "Episodes",
									value: userSummary.data.media.anime.episodes,
									type: "number",
								},
							]}
						/>
					</SimpleGrid>
					<Divider />
					<Title>Actions</Title>
					<Grid listType="grid">
						<Button
							variant="outline"
							leftIcon={<IconList />}
							onClick={() => {
								const name = prompt("Please enter name of the new list");
								if (name) createCollection.mutate({ input: { name } });
							}}
						>
							Create a collection
						</Button>
						<Link passHref legacyBehavior href={ROUTES.media.create}>
							<Button
								variant="outline"
								component="a"
								leftIcon={<IconPhotoPlus />}
							>
								Create a media item
							</Button>
						</Link>
					</Grid>
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
