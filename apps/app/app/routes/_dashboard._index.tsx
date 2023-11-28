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
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
	CalendarEventPartFragment,
	CollectionContentsDocument,
	DashboardElementLot,
	GraphqlSortOrder,
	LatestUserSummaryDocument,
	MetadataLot,
	UserCollectionsListDocument,
	UserPreferences,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { formatTimeAgo } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconBarbell,
	IconFriends,
	IconPhotoPlus,
	IconScaleOutline,
	IconWeight,
} from "@tabler/icons-react";
import humanFormat from "human-format";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import { useAtom } from "jotai";
import { DateTime } from "luxon";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { ApplicationGrid } from "~/components/common";
import { MediaItemWithoutUpdateModal } from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getUserPreferences } from "~/lib/graphql.server";
import { useGetMantineColor } from "~/lib/hooks";
import { getLot, getMetadataIcon } from "~/lib/utilities";
import { currentWorkoutAtom, getDefaultWorkout } from "~/lib/workout";

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
	return json({
		userPreferences,
		latestUserSummary,
		userUpcomingCalendarEvents,
		collectionContents,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Home | Ryot" }];
};

export default function Index() {
	const loaderData = useLoaderData<typeof loader>();
	const theme = useMantineTheme();
	const navigate = useNavigate();
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	return (
		<Container>
			<Stack gap={32}>
				{currentWorkout ? (
					<Alert
						icon={<IconAlertCircle size={16} />}
						variant="outline"
						color="yellow"
					>
						<Text size="lg">
							You have a workout in progress. Click{" "}
							<Anchor component={Link} to={$path("/fitness/workouts/current")}>
								here
							</Anchor>{" "}
							to continue.
						</Text>
					</Alert>
				) : undefined}
				{loaderData.userPreferences.general.dashboard.map((de) =>
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
							) : undefined,
						)
						.with([DashboardElementLot.InProgress, false], () =>
							loaderData.collectionContents.results.items.length > 0 ? (
								<Section key="inProgress">
									<Title>In Progress</Title>
									<ApplicationGrid>
										{loaderData.collectionContents.results.items.map((lm) => (
											<MediaItemWithoutUpdateModal
												key={lm.details.identifier}
												userPreferences={loaderData.userPreferences}
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
							) : undefined,
						)
						.with([DashboardElementLot.Summary, false], () => (
							<Section key="summary">
								<Title>Summary</Title>
								<Text size="xs" mt={-15}>
									Calculated{" "}
									{formatTimeAgo(
										new Date(loaderData.latestUserSummary.calculatedOn),
									)}
								</Text>
								<SimpleGrid
									cols={{ base: 1, sm: 2, md: 3 }}
									style={{ alignItems: "center" }}
									spacing="xs"
								>
									<DisplayStatForMediaType
										userPreferences={loaderData.userPreferences}
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
										userPreferences={loaderData.userPreferences}
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
										userPreferences={loaderData.userPreferences}
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
										userPreferences={loaderData.userPreferences}
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
										userPreferences={loaderData.userPreferences}
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
										userPreferences={loaderData.userPreferences}
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
										userPreferences={loaderData.userPreferences}
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
										userPreferences={loaderData.userPreferences}
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
										userPreferences={loaderData.userPreferences}
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
									{loaderData.userPreferences.featuresEnabled.media.enabled ? (
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
									) : undefined}
									{loaderData.userPreferences.featuresEnabled.fitness
										.enabled ? (
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
													label: "Workouts",
													value:
														loaderData.latestUserSummary.fitness
															.workoutsRecorded,
													type: "number",
													hideIfZero: true,
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
									) : undefined}
								</SimpleGrid>
							</Section>
						))
						.with([DashboardElementLot.Actions, false], () => (
							<Section key="actions">
								<Title>Actions</Title>
								<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
									{loaderData.userPreferences.featuresEnabled.fitness
										.enabled ? (
										currentWorkout ? (
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
													setCurrentWorkout(getDefaultWorkout());
													navigate($path("/fitness/workouts/current"));
												}}
											>
												Start a workout
											</Button>
										)
									) : undefined}
									{loaderData.userPreferences.featuresEnabled.media.enabled ? (
										<Button
											variant="outline"
											component={Link}
											leftSection={<IconPhotoPlus />}
											to={$path("/media/create")}
										>
											Create a media item
										</Button>
									) : undefined}
									{loaderData.userPreferences.featuresEnabled.fitness
										.enabled ? (
										<Button
											variant="outline"
											component={Link}
											leftSection={<IconWeight />}
											to={$path("/fitness/exercises/create-or-edit")}
										>
											Create an exercise
										</Button>
									) : undefined}
								</SimpleGrid>
							</Section>
						))
						.otherwise(() => undefined),
				)}
			</Stack>
		</Container>
	);
}

const today = new Date();
today.setHours(0, 0, 0, 0);

const UpComingMedia = ({ um }: { um: CalendarEventPartFragment }) => {
	const diff = DateTime.fromISO(um.date).diff(DateTime.fromJSDate(today));
	const numDaysLeft = parseInt(diff.as("days").toFixed(0));
	const loaderData = useLoaderData<typeof loader>();

	return (
		<MediaItemWithoutUpdateModal
			userPreferences={loaderData.userPreferences}
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

const service = new HumanizeDurationLanguage();
const humanizer = new HumanizeDuration(service);

const ActualDisplayStat = (props: {
	icon: JSX.Element;
	lot: string;
	data: {
		type: "duration" | "number";
		label: string;
		value: number;
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
								{d.type === "duration"
									? humanizer.humanize(d.value * 1000 * 60, {
											round: true,
											largest: 3,
									  })
									: humanFormat(d.value)}
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
	userPreferences: UserPreferences;
}) => {
	const getMantineColor = useGetMantineColor();
	const isEnabled = Object.entries(
		props.userPreferences.featuresEnabled.media || {},
	).find(([name, _]) => getLot(name) === props.lot);
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size={24} stroke={1.5} />;

	return isEnabled ? (
		isEnabled[1] && props.userPreferences.featuresEnabled.media.enabled ? (
			<Link
				to={$path("/media/:action/:lot", {
					action: "list",
					lot: props.lot.toLowerCase(),
				})}
				style={{ all: "unset", cursor: "pointer" }}
			>
				<ActualDisplayStat
					data={props.data}
					icon={icon}
					lot={props.lot.toString()}
					color={getMantineColor(props.lot)}
				/>
			</Link>
		) : undefined
	) : undefined;
};

const Section = (props: { children: JSX.Element[] }) => {
	return <Stack gap="sm">{props.children}</Stack>;
};
