import { $path } from "@ignisda/remix-routes";
import {
	Alert,
	Anchor,
	Box,
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
import {
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	type CalendarEventPartFragment,
	CollectionContentsDocument,
	DashboardElementLot,
	GraphqlSortOrder,
	LatestUserSummaryDocument,
	MediaLot,
	type UserMediaFeaturesEnabledPreferences,
	type UserPreferences,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { displayWeightWithUnit, humanizeDuration } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconBarbell,
	IconFriends,
	IconScaleOutline,
	IconServer,
} from "@tabler/icons-react";
import { parse } from "cookie";
import type { ReactNode } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { ApplicationGrid } from "~/components/common";
import {
	MediaItemWithoutUpdateModal,
	NewUserGuideAlert,
} from "~/components/media";
import {
	CurrentWorkoutKey,
	dayjsLib,
	getLot,
	getMetadataIcon,
} from "~/lib/generals";
import { useGetMantineColor } from "~/lib/hooks";
import {
	getAuthorizationHeader,
	getUserCollectionsList,
	getUserPreferences,
	gqlClient,
} from "~/lib/utilities.server";

const cookieName = CurrentWorkoutKey;

const getTake = (prefs: UserPreferences, el: DashboardElementLot) => {
	const t = prefs.general.dashboard.find(
		(de) => de.section === el,
	)?.numElements;
	invariant(typeof t === "number", `No take found for ${el}`);
	return t;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const prefs = await getUserPreferences(request);
	const takeUpcoming = getTake(prefs, DashboardElementLot.Upcoming);
	const takeInProgress = getTake(prefs, DashboardElementLot.InProgress);
	const userCollectionsList = await getUserCollectionsList(request);
	const foundCollection = userCollectionsList.find(
		(c) => c.name === "In Progress",
	);
	invariant(foundCollection, 'No collection found for "In Progress"');
	const { collectionContents } = await gqlClient.request(
		CollectionContentsDocument,
		{
			input: {
				collectionId: foundCollection.id,
				take: takeInProgress,
				sort: { order: GraphqlSortOrder.Desc },
			},
		},
		await getAuthorizationHeader(request),
	);
	const { userUpcomingCalendarEvents } = await gqlClient.request(
		UserUpcomingCalendarEventsDocument,
		{ input: { nextMedia: takeUpcoming } },
		await getAuthorizationHeader(request),
	);
	const { latestUserSummary } = await gqlClient.request(
		LatestUserSummaryDocument,
		undefined,
		await getAuthorizationHeader(request),
	);
	const cookies = request.headers.get("cookie");
	const workoutInProgress = parse(cookies || "")[cookieName] === "true";
	return json({
		workoutInProgress,
		userPreferences: {
			reviewScale: prefs.general.reviewScale,
			dashboard: prefs.general.dashboard,
			media: prefs.featuresEnabled.media,
			fitness: prefs.featuresEnabled.fitness,
			unitSystem: prefs.fitness.exercises.unitSystem,
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
				{loaderData.latestUserSummary.media.metadataOverall.interactedWith ===
				0 ? (
					<NewUserGuideAlert />
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
										lot={MediaLot.Movie}
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
										lot={MediaLot.Show}
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
										lot={MediaLot.VideoGame}
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
										lot={MediaLot.VisualNovel}
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
										lot={MediaLot.AudioBook}
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
										lot={MediaLot.Book}
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
										lot={MediaLot.Podcast}
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
										lot={MediaLot.Manga}
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
										lot={MediaLot.Anime}
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
										<>
											<ActualDisplayStat
												icon={<IconServer />}
												lot="Metadata stats"
												color={theme.colors.grape[8]}
												data={[
													{
														label: "Media",
														value:
															loaderData.latestUserSummary.media.metadataOverall
																.interactedWith,
														type: "number",
													},
													{
														label: "Reviews",
														value:
															loaderData.latestUserSummary.media.metadataOverall
																.reviewed,
														type: "number",
														hideIfZero: true,
													},
												]}
											/>
											{loaderData.userPreferences.media.people ? (
												<ActualDisplayStat
													icon={<IconFriends />}
													lot="People stats"
													color={theme.colors.red[9]}
													data={[
														{
															label: "People",
															value:
																loaderData.latestUserSummary.media.peopleOverall
																	.interactedWith,
															type: "number",
														},
														{
															label: "Reviews",
															value:
																loaderData.latestUserSummary.media.peopleOverall
																	.reviewed,
															type: "number",
															hideIfZero: true,
														},
													]}
												/>
											) : null}
										</>
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
						MediaLot.Show,
						() =>
							`S${um.showExtraInformation?.season}-E${um.showExtraInformation?.episode}`,
					)
					.with(
						MediaLot.Podcast,
						() => `EP-${um.podcastExtraInformation?.episode}`,
					)
					.otherwise(() => "")} ${
					numDaysLeft === 0
						? "Today"
						: `in ${numDaysLeft === 1 ? "a" : numDaysLeft} day${
								numDaysLeft === 1 ? "" : "s"
						  }`
				}`,
			}}
			lot={um.metadataLot}
			noBottomRight
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
						<Box
							key={idx.toString()}
							mx="xs"
							data-stat-stringified={JSON.stringify(d)}
						>
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
	lot: MediaLot;
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
