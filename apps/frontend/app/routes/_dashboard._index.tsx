import { $path } from "@ignisda/remix-routes";
import {
	Alert,
	Anchor,
	Box,
	Button,
	Center,
	Container,
	Flex,
	RingProgress,
	SimpleGrid,
	Stack,
	Text,
	Title,
	useMantineTheme,
} from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	CalendarEventPartFragment,
	CollectionContentsDocument,
	DashboardElementLot,
	GraphqlSortOrder,
	LatestUserSummaryDocument,
	MetadataLot,
	UserCollectionsListDocument,
	UserMediaFeaturesEnabledPreferences,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { displayWeightWithUnit, humanizeDuration } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconArrowsRight,
	IconBarbell,
	IconFriends,
	IconPhotoPlus,
	IconScaleOutline,
	IconWeight,
} from "@tabler/icons-react";
import { parse } from "cookie";
import { ReactNode } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { ApplicationGrid } from "~/components/common";
import { MediaItemWithoutUpdateModal } from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import {
	COOKIES_KEYS,
	dayjsLib,
	getLot,
	getMetadataIcon,
} from "~/lib/generals";
import { getUserPreferences } from "~/lib/graphql.server";
import { getWorkoutStarter, useGetMantineColor } from "~/lib/hooks";
import { getDefaultWorkout } from "~/lib/workout";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const userPreferences = await getUserPreferences(request);
	const take = userPreferences.general.dashboard.find(
		(de) => de.section === DashboardElementLot.InProgress,
	)?.numElements;
	invariant(take, "No take found for in progress");
	const { userCollectionsList } = await gqlClient.request(
		UserCollectionsListDocument,
		{ name: "In Progress" },
		await getAuthorizationHeader(request),
	);
	const collectionId = userCollectionsList[0].id;
	const { collectionContents } = await gqlClient.request(
		CollectionContentsDocument,
		{ input: { collectionId, take, sort: { order: GraphqlSortOrder.Desc } } },
		await getAuthorizationHeader(request),
	);
	const { userUpcomingCalendarEvents } = await gqlClient.request(
		UserUpcomingCalendarEventsDocument,
		{ input: { nextMedia: take } },
		await getAuthorizationHeader(request),
	);
	const { latestUserSummary } = await gqlClient.request(
		LatestUserSummaryDocument,
		undefined,
		await getAuthorizationHeader(request),
	);
	const cookies = request.headers.get("Cookie");
	const workoutInProgress =
		parse(cookies || "")[COOKIES_KEYS.isWorkoutInProgress] === "true";
	return json({
		workoutInProgress,
		userPreferences: {
			reviewScale: userPreferences.general.reviewScale,
			dashboard: userPreferences.general.dashboard,
			media: userPreferences.featuresEnabled.media,
			fitness: userPreferences.featuresEnabled.fitness,
			unitSystem: userPreferences.fitness.exercises.unitSystem,
		},
		latestUserSummary,
		userUpcomingCalendarEvents,
		collectionContents,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Home | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const theme = useMantineTheme();
	const startWorkout = getWorkoutStarter();

	return (
		<Container>
			<Stack gap={32}>
				{loaderData.workoutInProgress ? (
					<Alert icon={<IconAlertCircle />} variant="outline" color="yellow">
						<Text>
							You have a workout in progress. Click{" "}
							<Anchor component={Link} to={$path("/fitness/workouts/current")}>
								here
							</Anchor>{" "}
							to continue.
						</Text>
					</Alert>
				) : null}
				{loaderData.latestUserSummary.media.mediaInteractedWith === 0 ? (
					<Alert icon={<IconArrowsRight />} variant="outline" color="teal">
						<Text>
							To get started, select a media type from the sidebar, enter a
							query in the search tab, and add a media to your seen history or
							watchlist.
						</Text>
						<Text mt="xs">
							This notice will disappear once your summary is re-calculated.
						</Text>
					</Alert>
				) : null}
				{loaderData.userPreferences.dashboard.map((de) =>
					match([de.section, de.hidden])
						.with([DashboardElementLot.Upcoming, false], () =>
							loaderData.userUpcomingCalendarEvents.length > 0 ? (
								<Section key="upcoming">
									<Title>Upcoming</Title>
									<ApplicationGrid>
										{loaderData.userUpcomingCalendarEvents.map((um) => (
											<UpComingMedia um={um} key={um.calendarEventId} />
										))}
									</ApplicationGrid>
								</Section>
							) : null,
						)
						.with([DashboardElementLot.InProgress, false], () =>
							loaderData.collectionContents.results.items.length > 0 ? (
								<Section key="inProgress">
									<Title>In Progress</Title>
									<ApplicationGrid>
										{loaderData.collectionContents.results.items.map((lm) => (
											<MediaItemWithoutUpdateModal
												key={lm.details.identifier}
												reviewScale={loaderData.userPreferences.reviewScale}
												item={{
													...lm.details,
													publishYear: lm.details.publishYear?.toString(),
												}}
												lot={lm.metadataLot}
												entityLot={lm.entityLot}
												noRatingLink
											/>
										))}
									</ApplicationGrid>
								</Section>
							) : null,
						)
						.with([DashboardElementLot.Summary, false], () => (
							<Section key="summary">
								<Title>Summary</Title>
								<Text size="xs" mt={-15}>
									Calculated{" "}
									{dayjsLib(
										loaderData.latestUserSummary.calculatedOn,
									).fromNow()}
								</Text>
								<SimpleGrid
									cols={{ base: 1, sm: 2, md: 3 }}
									style={{ alignItems: "center" }}
									spacing="xs"
								>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.Movie}
										data={[
											{
												label: "Movies",
												value:
													loaderData.latestUserSummary.media.movies.watched,
												type: "number",
											},
											{
												label: "Runtime",
												value:
													loaderData.latestUserSummary.media.movies.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.Show}
										data={[
											{
												label: "Shows",
												value: loaderData.latestUserSummary.media.shows.watched,
												type: "number",
											},
											{
												label: "Seasons",
												value:
													loaderData.latestUserSummary.media.shows
														.watchedSeasons,
												type: "number",
											},
											{
												label: "Episodes",
												value:
													loaderData.latestUserSummary.media.shows
														.watchedEpisodes,
												type: "number",
											},
											{
												label: "Runtime",
												value: loaderData.latestUserSummary.media.shows.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.VideoGame}
										data={[
											{
												label: "Video games",
												value:
													loaderData.latestUserSummary.media.videoGames.played,
												type: "number",
											},
										]}
									/>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.VisualNovel}
										data={[
											{
												label: "Visual Novels",
												value:
													loaderData.latestUserSummary.media.visualNovels
														.played,
												type: "number",
											},
											{
												label: "Runtime",
												value:
													loaderData.latestUserSummary.media.visualNovels
														.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.AudioBook}
										data={[
											{
												label: "Audiobooks",
												value:
													loaderData.latestUserSummary.media.audioBooks.played,
												type: "number",
											},
											{
												label: "Runtime",
												value:
													loaderData.latestUserSummary.media.audioBooks.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.Book}
										data={[
											{
												label: "Books",
												value: loaderData.latestUserSummary.media.books.read,
												type: "number",
											},
											{
												label: "Pages",
												value: loaderData.latestUserSummary.media.books.pages,
												type: "number",
											},
										]}
									/>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.Podcast}
										data={[
											{
												label: "Podcasts",
												value:
													loaderData.latestUserSummary.media.podcasts.played,
												type: "number",
											},
											{
												label: "Episodes",
												value:
													loaderData.latestUserSummary.media.podcasts
														.playedEpisodes,
												type: "number",
											},
											{
												label: "Runtime",
												value:
													loaderData.latestUserSummary.media.podcasts.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.Manga}
										data={[
											{
												label: "Manga",
												value: loaderData.latestUserSummary.media.manga.read,
												type: "number",
											},
											{
												label: "Chapters",
												value:
													loaderData.latestUserSummary.media.manga.chapters,
												type: "number",
											},
										]}
									/>
									<DisplayStatForMediaType
										media={loaderData.userPreferences.media}
										lot={MetadataLot.Anime}
										data={[
											{
												label: "Anime",
												value: loaderData.latestUserSummary.media.anime.watched,
												type: "number",
											},
											{
												label: "Episodes",
												value:
													loaderData.latestUserSummary.media.anime.episodes,
												type: "number",
											},
										]}
									/>
									{loaderData.userPreferences.media.enabled ? (
										<ActualDisplayStat
											icon={<IconFriends />}
											lot="General stats"
											color={theme.colors.grape[8]}
											data={[
												{
													label: "Media",
													value:
														loaderData.latestUserSummary.media
															.mediaInteractedWith,
													type: "number",
												},
												{
													label: "Reviews",
													value:
														loaderData.latestUserSummary.media.reviewsPosted,
													type: "number",
													hideIfZero: true,
												},
												{
													label: "People",
													value:
														loaderData.latestUserSummary.media
															.creatorsInteractedWith,
													type: "number",
												},
											]}
										/>
									) : null}
									{loaderData.userPreferences.fitness.enabled &&
									loaderData.latestUserSummary.fitness.workouts.duration +
										loaderData.latestUserSummary.fitness.workouts.recorded >
										0 ? (
										<UnstyledLink to={$path("/fitness/workouts/list")}>
											<ActualDisplayStat
												icon={<IconBarbell stroke={1.3} />}
												lot="Workouts"
												color={theme.colors.teal[2]}
												data={[
													{
														label: "Workouts",
														value:
															loaderData.latestUserSummary.fitness.workouts
																.recorded,
														type: "number",
													},
													{
														label: "Runtime",
														value:
															loaderData.latestUserSummary.fitness.workouts
																.duration,
														type: "duration",
													},
													{
														label: "Runtime",
														value: displayWeightWithUnit(
															loaderData.userPreferences.unitSystem,
															loaderData.latestUserSummary.fitness.workouts
																.weight,
															true,
														),
														type: "string",
													},
												]}
											/>
										</UnstyledLink>
									) : null}
									{loaderData.userPreferences.fitness.enabled &&
									loaderData.latestUserSummary.fitness.measurementsRecorded +
										loaderData.latestUserSummary.fitness
											.exercisesInteractedWith >
										0 ? (
										<ActualDisplayStat
											icon={<IconScaleOutline stroke={1.3} />}
											lot="Fitness"
											color={theme.colors.yellow[5]}
											data={[
												{
													label: "Measurements",
													value:
														loaderData.latestUserSummary.fitness
															.measurementsRecorded,
													type: "number",
												},
												{
													label: "Exercises",
													value:
														loaderData.latestUserSummary.fitness
															.exercisesInteractedWith,
													type: "number",
													hideIfZero: true,
												},
											]}
										/>
									) : null}
								</SimpleGrid>
							</Section>
						))
						.with([DashboardElementLot.Actions, false], () => (
							<Section key="actions">
								<Title>Actions</Title>
								<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
									{loaderData.userPreferences.fitness.enabled ? (
										loaderData.workoutInProgress ? (
											<Button
												variant="outline"
												to={$path("/fitness/workouts/current")}
												component={Link}
												leftSection={<IconBarbell />}
											>
												Go to current workout
											</Button>
										) : (
											<Button
												variant="outline"
												leftSection={<IconBarbell />}
												onClick={() => {
													startWorkout(getDefaultWorkout());
												}}
											>
												Start a workout
											</Button>
										)
									) : null}
									{loaderData.userPreferences.media.enabled ? (
										<Button
											variant="outline"
											component={Link}
											leftSection={<IconPhotoPlus />}
											to={$path("/media/create")}
										>
											Create a media item
										</Button>
									) : null}
									{loaderData.userPreferences.fitness.enabled ? (
										<Button
											variant="outline"
											component={Link}
											leftSection={<IconWeight />}
											to={$path("/fitness/exercises/create")}
										>
											Create an exercise
										</Button>
									) : null}
								</SimpleGrid>
							</Section>
						))
						.otherwise(() => undefined),
				)}
			</Stack>
		</Container>
	);
}

const UpComingMedia = ({ um }: { um: CalendarEventPartFragment }) => {
	const today = dayjsLib().startOf("day");
	const numDaysLeft = dayjsLib(um.date).diff(today, "day");
	const loaderData = useLoaderData<typeof loader>();

	return (
		<MediaItemWithoutUpdateModal
			reviewScale={loaderData.userPreferences.reviewScale}
			item={{
				identifier: um.metadataId.toString(),
				title: um.metadataTitle,
				image: um.metadataImage,
				publishYear: `${match(um.metadataLot)
					.with(
						MetadataLot.Show,
						() => `S${um.showSeasonNumber}E${um.showEpisodeNumber}`,
					)
					.with(MetadataLot.Podcast, () => `EP${um.podcastEpisodeNumber}`)
					.otherwise(() => "")} ${
					numDaysLeft === 0
						? "Today"
						: `In ${numDaysLeft === 1 ? "a" : numDaysLeft} day${
								numDaysLeft === 1 ? "" : "s"
						  }`
				}`,
			}}
			lot={um.metadataLot}
			noRatingLink
		/>
	);
};

const ActualDisplayStat = (props: {
	icon: ReactNode;
	lot: string;
	data: {
		type: "duration" | "number" | "string";
		label: string;
		value: number | string;
		hideIfZero?: true;
	}[];
	color?: string;
}) => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	return (
		<Flex align="center">
			<RingProgress
				size={60}
				thickness={4}
				sections={[]}
				label={<Center>{props.icon}</Center>}
				rootColor={props.color ?? colors[11]}
			/>
			<Flex wrap="wrap" ml="xs">
				{props.data.map((d, idx) =>
					d.type === "number" && d.value === 0 && d.hideIfZero ? undefined : (
						<Box key={idx.toString()} mx="xs">
							<Text
								fw={d.label !== "Runtime" ? "bold" : undefined}
								display="inline"
								fz={{ base: "md", md: "sm", xl: "md" }}
							>
								{match(d.type)
									.with("string", () => d.value)
									.with("duration", () =>
										humanizeDuration(Number(d.value) * 1000 * 60, {
											round: true,
											largest: 3,
										}),
									)
									.with("number", () =>
										new Intl.NumberFormat("en-US", {
											notation: "compact",
										}).format(Number(d.value)),
									)
									.exhaustive()}
							</Text>
							<Text
								display="inline"
								ml="4px"
								fz={{ base: "md", md: "sm", xl: "md" }}
							>
								{d.label === "Runtime" ? "" : d.label}
							</Text>
						</Box>
					),
				)}
			</Flex>
		</Flex>
	);
};

const DisplayStatForMediaType = (props: {
	lot: MetadataLot;
	data: { type: "duration" | "number"; label: string; value: number }[];
	media: UserMediaFeaturesEnabledPreferences;
}) => {
	const getMantineColor = useGetMantineColor();
	const isEnabled = Object.entries(props.media || {}).find(
		([name, _]) => getLot(name) === props.lot,
	);
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size={24} stroke={1.5} />;

	return isEnabled ? (
		isEnabled[1] && props.media.enabled ? (
			<UnstyledLink
				to={$path("/media/:action/:lot", {
					action: "list",
					lot: props.lot.toLowerCase(),
				})}
			>
				<ActualDisplayStat
					data={props.data}
					icon={icon}
					lot={props.lot.toString()}
					color={getMantineColor(props.lot)}
				/>
			</UnstyledLink>
		) : null
	) : null;
};

const Section = (props: { children: ReactNode[] }) => {
	return <Stack gap="sm">{props.children}</Stack>;
};

const UnstyledLink = (props: { children: ReactNode; to: string }) => {
	return (
		<Link to={props.to} style={{ all: "unset", cursor: "pointer" }}>
			{props.children}
		</Link>
	);
};
