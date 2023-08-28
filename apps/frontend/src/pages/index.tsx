import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaComponents";
import { APP_ROUTES } from "@/lib/constants";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { currentWorkoutAtom, getDefaultWorkout } from "@/lib/state";
import { getLot, getMetadataIcon, getStringAsciiValue } from "@/lib/utilities";
import {
	Alert,
	Anchor,
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
import { formatTimeAgo } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconBarbell,
	IconFriends,
	IconPhotoPlus,
	IconScaleOutline,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import humanFormat from "human-format";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import { useAtom } from "jotai";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import { withQuery } from "ufo";

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
							fz={{ base: "md", md: "sm" }}
						>
							{d.type === "duration"
								? humaizer.humanize(d.value * 1000 * 60, {
										round: true,
										largest: 3,
								  })
								: humanFormat(d.value)}
						</Text>
						<Text display={"inline"} ml="4px" fz={{ base: "md", md: "sm" }}>
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
	const userPreferences = useUserPreferences();
	const isEnabled = Object.entries(
		userPreferences.data?.featuresEnabled.media || {},
	).find(([name, _]) => getLot(name) === props.lot)!;
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size="1.5rem" stroke={1.5} />;
	return isEnabled ? (
		isEnabled[1] && userPreferences.data?.featuresEnabled.media.enabled ? (
			<Link
				href={withQuery(APP_ROUTES.media.list, {
					lot: props.lot.toLowerCase(),
				})}
				style={{ textDecoration: "none" }}
			>
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
			</Link>
		) : undefined
	) : undefined;
};

const Page: NextPageWithLayout = () => {
	const theme = useMantineTheme();
	const router = useRouter();
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	const userPreferences = useUserPreferences();
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
			{ input: { collectionId: id, page: 1, take: 8 } },
		);
		return collectionContents;
	});

	return userPreferences.data &&
		latestUserSummary.data &&
		inProgressCollection.data &&
		inProgressCollection.data.results &&
		inProgressCollection.data.details ? (
		<>
			<Head>
				<title>Home | Ryot</title>
			</Head>
			<Container>
				<Stack>
					{currentWorkout ? (
						<Alert
							icon={<IconAlertCircle size="1rem" />}
							variant="outline"
							color="yellow"
						>
							<Text size="lg">
								You have a workout in progress. Click{" "}
								<Link
									passHref
									legacyBehavior
									href={APP_ROUTES.fitness.exercises.currentWorkout}
								>
									<Anchor>here</Anchor>
								</Link>{" "}
								to continue.
							</Text>
						</Alert>
					) : undefined}
					{inProgressCollection.data.results.items.length > 0 ? (
						<>
							<Title>{inProgressCollection.data.details.name}</Title>
							<Grid>
								{inProgressCollection.data.results.items.map((lm) => (
									<MediaItemWithoutUpdateModal
										key={lm.details.identifier}
										item={lm.details}
										lot={lm.lot}
										href={withQuery(
											APP_ROUTES.media.individualMediaItem.details,
											{ id: lm.details.identifier },
										)}
										noRatingLink
									/>
								))}
							</Grid>
							<Divider />
						</>
					) : undefined}
					<Title>Summary</Title>
					<Text size="xs" mt={-15}>
						Calculated {formatTimeAgo(latestUserSummary.data.calculatedOn)}
					</Text>
					<SimpleGrid
						cols={1}
						style={{ alignItems: "center" }}
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
						{userPreferences.data.featuresEnabled.media.enabled ? (
							<ActualDisplayStat
								icon={<IconFriends />}
								lot="General stats"
								color={theme.colors.grape[8]}
								data={[
									{
										label: "Reviews",
										value: latestUserSummary.data.media.reviewsPosted,
										type: "number",
									},
									{
										label: "People",
										value: latestUserSummary.data.media.creatorsInteractedWith,
										type: "number",
									},
								]}
							/>
						) : undefined}
						{userPreferences.data.featuresEnabled.fitness.enabled ? (
							<ActualDisplayStat
								icon={<IconScaleOutline stroke={1.3} />}
								lot="Fitness"
								color={theme.colors.yellow[5]}
								data={[
									{
										label: "Measurements",
										value: latestUserSummary.data.fitness.measurementsRecorded,
										type: "number",
									},
									{
										label: "Workouts",
										value: latestUserSummary.data.fitness.workoutsRecorded,
										type: "number",
									},
								]}
							/>
						) : undefined}
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
						<Link
							passHref
							legacyBehavior
							href={APP_ROUTES.media.individualMediaItem.create}
						>
							<Button
								variant="outline"
								component="a"
								leftIcon={<IconPhotoPlus />}
							>
								Create a media item
							</Button>
						</Link>
						{currentWorkout ? (
							<Link
								passHref
								legacyBehavior
								href={APP_ROUTES.fitness.exercises.currentWorkout}
							>
								<Button
									variant="outline"
									component="a"
									leftIcon={<IconBarbell />}
									onClick={() => {}}
								>
									Go to current workout
								</Button>
							</Link>
						) : (
							<Button
								variant="outline"
								leftIcon={<IconBarbell />}
								onClick={() => {
									setCurrentWorkout(getDefaultWorkout());
									router.push(APP_ROUTES.fitness.exercises.currentWorkout);
								}}
							>
								Start a workout
							</Button>
						)}
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
