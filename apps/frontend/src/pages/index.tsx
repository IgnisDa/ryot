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
import {
	CollectionContentsDocument,
	CollectionsDocument,
	LatestUserSummaryDocument,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import { formatTimeAgo } from "@ryot/utilities";
import {
	IconDatabaseImport,
	IconMessage2,
	IconPhotoPlus,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
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

const ActualDisplayStat = (props: {
	icon: JSX.Element;
	lot: string;
	data: { type: "duration" | "number"; label: string; value: number }[];
	color?: string;
}) => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	return (
		<Paper component={Flex} align={"center"}>
			<RingProgress
				size={60}
				thickness={4}
				sections={[]}
				label={<Center>{props.icon}</Center>}
				rootColor={props.color ?? colors[11]}
			/>
			<Flex wrap={"wrap"} ml="xs">
				{props.data.map((d, idx) => (
					<Box key={idx.toString()} mx={"xs"}>
						<Text
							fw={d.label !== "Runtime" ? "bold" : undefined}
							display={"inline"}
							size="sm"
						>
							{d.type === "duration"
								? humaizer.humanize(d.value * 1000 * 60, {
										round: true,
										largest: 3,
								  })
								: humanFormat(d.value)}
						</Text>
						<Text display={"inline"} ml="4px" size="sm">
							{d.label === "Runtime" ? "" : d.label}
						</Text>
					</Box>
				))}
			</Flex>
		</Paper>
	);
};

const DisplayStatForMediaType = (props: {
	lot: MetadataLot;
	data: { type: "duration" | "number"; label: string; value: number }[];
}) => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);
	const userPrefs = useUserPreferences();
	const isEnabled = Object.entries(
		userPrefs.data?.featuresEnabled.media || {},
	).find(([name, _]) => getLot(name) === props.lot)!;
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size="1.5rem" stroke={1.5} />;
	return isEnabled ? (
		isEnabled[1] ? (
			<ActualDisplayStat
				data={props.data}
				icon={icon}
				lot={props.lot.toString()}
				color={
					colors[
						(getStringAsciiValue(props.lot) + colors.length) % colors.length
					]
				}
			/>
		) : null
	) : null;
};

const Page: NextPageWithLayout = () => {
	const latestUserSummary = useQuery(
		["userSummary"],
		async () => {
			const { latestUserSummary } = await gqlClient.request(
				LatestUserSummaryDocument,
			);
			return latestUserSummary;
		},
		{ retry: false },
	);
	const inProgressCollection = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(CollectionsDocument, {
			input: { name: "In Progress" },
		});
		const id = collections[0].id;
		const { collectionContents } = await gqlClient.request(
			CollectionContentsDocument,
			{
				input: { collectionId: id, page: 1 },
			},
		);
		return collectionContents;
	});

	return latestUserSummary.data &&
		inProgressCollection.data &&
		inProgressCollection.data.results &&
		inProgressCollection.data.details ? (
		<>
			<Head>
				<title>Home | Ryot</title>
			</Head>
			<Container>
				<Stack>
					{inProgressCollection.data.results.items.length > 0 ? (
						<>
							<Title>{inProgressCollection.data.details.name}</Title>
							<Grid>
								{inProgressCollection.data.results.items.map((lm) => (
									<MediaItemWithoutUpdateModal
										key={lm.identifier}
										item={lm}
										lot={lm.lot}
										href={`${ROUTES.media.individualMedia.details}?item=${lm.identifier}`}
									/>
								))}
							</Grid>
							<Divider />
						</>
					) : null}
					<Title>Summary</Title>
					<Text size="xs" mt={-15}>
						Calculated {formatTimeAgo(latestUserSummary.data.calculatedOn)}
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
									value: latestUserSummary.data.media.movies.watched,
									type: "number",
								},
								{
									label: "Runtime",
									value: latestUserSummary.data.media.movies.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Show}
							data={[
								{
									label: "Shows",
									value: latestUserSummary.data.media.shows.watched,
									type: "number",
								},
								{
									label: "Seasons",
									value: latestUserSummary.data.media.shows.watchedSeasons,
									type: "number",
								},
								{
									label: "Episodes",
									value: latestUserSummary.data.media.shows.watchedEpisodes,
									type: "number",
								},
								{
									label: "Runtime",
									value: latestUserSummary.data.media.shows.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.VideoGame}
							data={[
								{
									label: "Video games",
									value: latestUserSummary.data.media.videoGames.played,
									type: "number",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.AudioBook}
							data={[
								{
									label: "Audiobooks",
									value: latestUserSummary.data.media.audioBooks.played,
									type: "number",
								},
								{
									label: "Runtime",
									value: latestUserSummary.data.media.audioBooks.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Book}
							data={[
								{
									label: "Books",
									value: latestUserSummary.data.media.books.read,
									type: "number",
								},
								{
									label: "Pages",
									value: latestUserSummary.data.media.books.pages,
									type: "number",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Podcast}
							data={[
								{
									label: "Podcasts",
									value: latestUserSummary.data.media.podcasts.played,
									type: "number",
								},
								{
									label: "Episodes",
									value: latestUserSummary.data.media.podcasts.playedEpisodes,
									type: "number",
								},
								{
									label: "Runtime",
									value: latestUserSummary.data.media.podcasts.runtime,
									type: "duration",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Manga}
							data={[
								{
									label: "Manga",
									value: latestUserSummary.data.media.manga.read,
									type: "number",
								},
								{
									label: "Chapters",
									value: latestUserSummary.data.media.manga.chapters,
									type: "number",
								},
							]}
						/>
						<DisplayStatForMediaType
							lot={MetadataLot.Anime}
							data={[
								{
									label: "Anime",
									value: latestUserSummary.data.media.anime.watched,
									type: "number",
								},
								{
									label: "Episodes",
									value: latestUserSummary.data.media.anime.episodes,
									type: "number",
								},
							]}
						/>
						<ActualDisplayStat
							icon={<IconMessage2 />}
							lot="Review"
							data={[
								{
									label: "Reviews",
									value: latestUserSummary.data.media.reviewsPosted,
									type: "number",
								},
							]}
						/>
					</SimpleGrid>
					<Divider />
					<Title>Actions</Title>
					<SimpleGrid
						cols={1}
						spacing="lg"
						breakpoints={[
							{ minWidth: "sm", cols: 2 },
							{ minWidth: "lg", cols: 3 },
						]}
					>
						<Link passHref legacyBehavior href={ROUTES.imports.new}>
							<Button
								variant="outline"
								component="a"
								leftIcon={<IconDatabaseImport />}
							>
								New import
							</Button>
						</Link>
						<Link
							passHref
							legacyBehavior
							href={ROUTES.media.individualMedia.create}
						>
							<Button
								variant="outline"
								component="a"
								leftIcon={<IconPhotoPlus />}
							>
								Create a media item
							</Button>
						</Link>
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
