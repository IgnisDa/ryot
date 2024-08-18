import { BarChart } from "@mantine/charts";
import {
	Alert,
	Box,
	Center,
	Container,
	Flex,
	LoadingOverlay,
	type MantineColor,
	Paper,
	RingProgress,
	Select,
	SimpleGrid,
	Stack,
	Text,
	Title,
	useMantineTheme,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { Link, useLoaderData } from "@remix-run/react";
import {
	type CalendarEventPartFragment,
	CollectionContentsDocument,
	DailyUserActivitiesDocument,
	DashboardElementLot,
	GraphqlSortOrder,
	LatestUserSummaryDocument,
	MediaLot,
	type UserPreferences,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	humanizeDuration,
	isBoolean,
	isNumber,
	mapValues,
	pickBy,
} from "@ryot/ts-utils";
import {
	IconBarbell,
	IconFriends,
	IconInfoCircle,
	IconScaleOutline,
	IconServer,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { ApplicationGrid, ProRequiredAlert } from "~/components/common";
import { displayWeightWithUnit } from "~/components/fitness";
import {
	DisplayCollectionEntity,
	MetadataDisplayItem,
} from "~/components/media";
import {
	TimeSpan,
	clientGqlService,
	dayjsLib,
	getLot,
	getMetadataIcon,
	getTimeOfDay,
	queryFactory,
} from "~/lib/generals";
import {
	useDashboardLayoutData,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/hooks";
import {
	getCachedUserCollectionsList,
	getCachedUserPreferences,
	serverGqlService,
} from "~/lib/utilities.server";

const getTake = (preferences: UserPreferences, el: DashboardElementLot) => {
	const t = preferences.general.dashboard.find(
		(de) => de.section === el,
	)?.numElements;
	invariant(isNumber(t));
	return t;
};

export const loader = unstable_defineLoader(async ({ request }) => {
	const preferences = await getCachedUserPreferences(request);
	const takeUpcoming = getTake(preferences, DashboardElementLot.Upcoming);
	const takeInProgress = getTake(preferences, DashboardElementLot.InProgress);
	const userCollectionsList = await getCachedUserCollectionsList(request);
	const foundInProgressCollection = userCollectionsList.find(
		(c) => c.name === "In Progress",
	);
	invariant(foundInProgressCollection);
	const [
		{ collectionContents: inProgressCollectionContents },
		{ userUpcomingCalendarEvents },
		{ latestUserSummary },
	] = await Promise.all([
		serverGqlService.authenticatedRequest(request, CollectionContentsDocument, {
			input: {
				collectionId: foundInProgressCollection.id,
				take: takeInProgress,
				sort: { order: GraphqlSortOrder.Desc },
			},
		}),
		serverGqlService.authenticatedRequest(
			request,
			UserUpcomingCalendarEventsDocument,
			{ input: { nextMedia: takeUpcoming } },
		),
		serverGqlService.authenticatedRequest(
			request,
			LatestUserSummaryDocument,
			undefined,
		),
	]);
	return {
		latestUserSummary,
		userUpcomingCalendarEvents,
		inProgressCollectionContents,
	};
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Home | Ryot" }];
};

type EntityColor = Record<MediaLot | (string & {}), MantineColor>;

const MediaColors: EntityColor = {
	ANIME: "blue",
	AUDIO_BOOK: "orange",
	BOOK: "lime",
	MANGA: "purple",
	MOVIE: "cyan",
	PODCAST: "yellow",
	SHOW: "red",
	VISUAL_NOVEL: "pink",
	VIDEO_GAME: "teal",
	WORKOUT: "violet",
	MEASUREMENT: "indigo",
	REVIEW: "green.5",
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const theme = useMantineTheme();
	const dashboardLayoutData = useDashboardLayoutData();
	const latestUserSummary = loaderData.latestUserSummary.data;

	return (
		<Container>
			<Stack gap={32}>
				{dashboardLayoutData.envData.FRONTEND_DASHBOARD_MESSAGE ? (
					<Alert variant="default" icon={<IconInfoCircle />}>
						{dashboardLayoutData.envData.FRONTEND_DASHBOARD_MESSAGE}
					</Alert>
				) : null}
				{userPreferences.general.dashboard.map((de) =>
					match([de.section, de.hidden])
						.with([DashboardElementLot.Upcoming, false], () =>
							loaderData.userUpcomingCalendarEvents.length > 0 ? (
								<Section
									key={DashboardElementLot.Upcoming}
									lot={DashboardElementLot.Upcoming}
								>
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
							loaderData.inProgressCollectionContents.results.items.length >
							0 ? (
								<Section
									key={DashboardElementLot.InProgress}
									lot={DashboardElementLot.InProgress}
								>
									<Title>In Progress</Title>
									<ApplicationGrid>
										{loaderData.inProgressCollectionContents.results.items.map(
											(lm) => (
												<DisplayCollectionEntity
													key={lm.entityId}
													entityId={lm.entityId}
													entityLot={lm.entityLot}
												/>
											),
										)}
									</ApplicationGrid>
								</Section>
							) : null,
						)
						.with([DashboardElementLot.Recommendations, false], () => (
							<Section
								key={DashboardElementLot.Recommendations}
								lot={DashboardElementLot.Recommendations}
							>
								<Title>Recommendations</Title>
								<ProRequiredAlert tooltipLabel="Get new recommendations every hour" />
							</Section>
						))
						.with([DashboardElementLot.Activity, false], () => (
							<Section
								key={DashboardElementLot.Activity}
								lot={DashboardElementLot.Activity}
							>
								<Title>Activity</Title>
								<ActivitySection />
							</Section>
						))
						.with([DashboardElementLot.Summary, false], () => (
							<Section
								key={DashboardElementLot.Summary}
								lot={DashboardElementLot.Summary}
							>
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
										lot={MediaLot.Movie}
										data={[
											{
												label: "Movies",
												value: latestUserSummary.media.movies.watched,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.media.movies.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Show}
										data={[
											{
												label: "Shows",
												value: latestUserSummary.media.shows.watched,
												type: "number",
											},
											{
												label: "Seasons",
												value: latestUserSummary.media.shows.watchedSeasons,
												type: "number",
											},
											{
												label: "Episodes",
												value: latestUserSummary.media.shows.watchedEpisodes,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.media.shows.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.VideoGame}
										data={[
											{
												label: "Video games",
												value: latestUserSummary.media.videoGames.played,
												type: "number",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.VisualNovel}
										data={[
											{
												label: "Visual Novels",
												value: latestUserSummary.media.visualNovels.played,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.media.visualNovels.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.AudioBook}
										data={[
											{
												label: "Audiobooks",
												value: latestUserSummary.media.audioBooks.played,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.media.audioBooks.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Book}
										data={[
											{
												label: "Books",
												value: latestUserSummary.media.books.read,
												type: "number",
											},
											{
												label: "Pages",
												value: latestUserSummary.media.books.pages,
												type: "number",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Podcast}
										data={[
											{
												label: "Podcasts",
												value: latestUserSummary.media.podcasts.played,
												type: "number",
											},
											{
												label: "Episodes",
												value: latestUserSummary.media.podcasts.playedEpisodes,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.media.podcasts.runtime,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Manga}
										data={[
											{
												label: "Manga",
												value: latestUserSummary.media.manga.read,
												type: "number",
											},
											{
												label: "Chapters",
												value: latestUserSummary.media.manga.chapters,
												type: "number",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Anime}
										data={[
											{
												label: "Anime",
												value: latestUserSummary.media.anime.watched,
												type: "number",
											},
											{
												label: "Episodes",
												value: latestUserSummary.media.anime.episodes,
												type: "number",
											},
										]}
									/>
									{userPreferences.featuresEnabled.media.enabled ? (
										<>
											<ActualDisplayStat
												icon={<IconServer />}
												lot="Metadata stats"
												color={theme.colors.grape[8]}
												data={[
													{
														label: "Media",
														value:
															latestUserSummary.media.metadataOverall
																.interactedWith,
														type: "number",
													},
													{
														label: "Reviews",
														value:
															latestUserSummary.media.metadataOverall.reviewed,
														type: "number",
														hideIfZero: true,
													},
												]}
											/>
											{userPreferences.featuresEnabled.media.people ? (
												<UnstyledLink
													to={$path("/media/people/:action", {
														action: "list",
													})}
												>
													<ActualDisplayStat
														icon={<IconFriends />}
														lot="People stats"
														color={theme.colors.red[9]}
														data={[
															{
																label: "People",
																value:
																	latestUserSummary.media.peopleOverall
																		.interactedWith,
																type: "number",
															},
															{
																label: "Reviews",
																value:
																	latestUserSummary.media.peopleOverall
																		.reviewed,
																type: "number",
																hideIfZero: true,
															},
														]}
													/>
												</UnstyledLink>
											) : null}
										</>
									) : null}
									{userPreferences.featuresEnabled.fitness.enabled &&
									Number(latestUserSummary.fitness.workouts.duration) +
										latestUserSummary.fitness.workouts.recorded >
										0 ? (
										<UnstyledLink
											to={$path("/fitness/:entity/list", {
												entity: "workouts",
											})}
										>
											<ActualDisplayStat
												icon={<IconBarbell stroke={1.3} />}
												lot="Workouts"
												color={theme.colors.teal[2]}
												data={[
													{
														label: "Workouts",
														value: latestUserSummary.fitness.workouts.recorded,
														type: "number",
													},
													{
														label: "Runtime",
														value: latestUserSummary.fitness.workouts.duration,
														type: "duration",
													},
													{
														label: "Runtime",
														value: displayWeightWithUnit(
															unitSystem,
															latestUserSummary.fitness.workouts.weight,
															true,
														),
														type: "string",
													},
												]}
											/>
										</UnstyledLink>
									) : null}
									{userPreferences.featuresEnabled.fitness.enabled &&
									latestUserSummary.fitness.measurementsRecorded +
										latestUserSummary.fitness.exercisesInteractedWith >
										0 ? (
										<ActualDisplayStat
											icon={<IconScaleOutline stroke={1.3} />}
											lot="Fitness"
											color={theme.colors.yellow[5]}
											data={[
												{
													label: "Measurements",
													value: latestUserSummary.fitness.measurementsRecorded,
													type: "number",
													hideIfZero: true,
												},
												{
													label: "Exercises",
													value:
														latestUserSummary.fitness.exercisesInteractedWith,
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

	return (
		<MetadataDisplayItem
			altName={um.episodeName || um.metadataTitle}
			metadataId={um.metadataId}
			noLeftLabel
			rightLabel={`${match(um.metadataLot)
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
					: `In ${numDaysLeft === 1 ? "a" : numDaysLeft} day${
							numDaysLeft === 1 ? "" : "s"
						}`
			}`}
		/>
	);
};

const ActualDisplayStat = (props: {
	icon: ReactNode;
	lot: string;
	data: Array<{
		type: "duration" | "number" | "string";
		label: string;
		value: number | string;
		hideIfZero?: true;
	}>;
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
				{props.data.map((d, idx) => (
					<Fragment key={idx.toString()}>
						{isNumber(d.type) && d.value === 0 && d.hideIfZero ? undefined : (
							<Box mx="xs" data-stat-stringified={JSON.stringify(d)}>
								<Text
									fw={d.label !== "Runtime" ? "bold" : undefined}
									display="inline"
									fz={{ base: "md", md: "sm", xl: "md" }}
								>
									{match(d.type)
										.with("string", () => d.value)
										.with("duration", () =>
											humanizeDuration(
												dayjsLib
													.duration(Number(d.value), "minutes")
													.asMilliseconds(),
												{
													round: true,
													largest: 3,
												},
											),
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
						)}
					</Fragment>
				))}
			</Flex>
		</Flex>
	);
};

const DisplayStatForMediaType = (props: {
	lot: MediaLot;
	data: Array<{ type: "duration" | "number"; label: string; value: number }>;
}) => {
	const userPreferences = useUserPreferences();
	const isEnabled = Object.entries(
		userPreferences.featuresEnabled.media || {},
	).find(([name, _]) => getLot(name) === props.lot);
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size={24} stroke={1.5} />;

	return isEnabled?.[1] && userPreferences.featuresEnabled.media.enabled ? (
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
				color={MediaColors[props.lot]}
			/>
		</UnstyledLink>
	) : null;
};

const Section = (props: {
	children: ReactNode | Array<ReactNode>;
	lot: DashboardElementLot;
}) => {
	return (
		<Stack gap="sm" id={props.lot}>
			{props.children}
		</Stack>
	);
};

const UnstyledLink = (props: { children: ReactNode; to: string }) => {
	return (
		<Link to={props.to} style={{ all: "unset", cursor: "pointer" }}>
			{props.children}
		</Link>
	);
};

const ActivitySection = () => {
	const [timeSpan, setTimeSpan] = useLocalStorage({
		defaultValue: TimeSpan.Last7Days,
		key: "ActivitySectionTimeSpan",
		getInitialValueInEffect: true,
	});
	const { data: dailyUserActivitiesData } = useQuery({
		queryKey: queryFactory.miscellaneous.dailyUserActivities().queryKey,
		queryFn: async () => {
			const { dailyUserActivities } = await clientGqlService.request(
				DailyUserActivitiesDocument,
				{ input: { startDate: "2024-07-15" } },
			);
			const trackSeries = mapValues(MediaColors, () => false);
			const data = dailyUserActivities.items.map((d) => {
				const data: Record<string, string | number> = {
					date: d.date,
					...(d.reviewCounts && { REVIEW: d.reviewCounts }),
					...(d.workoutCounts && { WORKOUT: d.workoutCounts }),
					...(d.measurementCounts && { MEASUREMENT: d.measurementCounts }),
				};
				for (const metadataCount of d.metadataCounts)
					data[metadataCount.lot] = metadataCount.count;
				for (const key in data)
					if (isBoolean(trackSeries[key])) trackSeries[key] = true;
				return data;
			});
			const series = pickBy(trackSeries, (v) => v);
			return {
				data,
				series,
				totalCount: dailyUserActivities.totalCount,
				mostActiveTimeOfDay: getTimeOfDay(
					convertUTCtoLocal(dailyUserActivities.mostActiveHour),
				),
			};
		},
	});

	return (
		<Stack pos="relative" h={400}>
			<LoadingOverlay
				visible={!dailyUserActivitiesData}
				zIndex={1000}
				overlayProps={{ radius: "md", blur: 3 }}
			/>
			{dailyUserActivitiesData ? (
				dailyUserActivitiesData.totalCount !== 0 ? (
					<>
						<SimpleGrid cols={3} mx={{ md: "xl" }}>
							<DisplayStat
								label="Total"
								value={dailyUserActivitiesData.totalCount}
							/>
							{dailyUserActivitiesData.mostActiveTimeOfDay ? (
								<DisplayStat
									label="Most active time"
									value={dailyUserActivitiesData.mostActiveTimeOfDay}
								/>
							) : undefined}
							<Select
								label="Time span"
								defaultValue={timeSpan}
								data={Object.values(TimeSpan)}
								onChange={(v) => {
									if (v) setTimeSpan(v as TimeSpan);
								}}
							/>
						</SimpleGrid>
						<BarChart
							h="100%"
							withLegend
							tickLine="x"
							dataKey="date"
							type="stacked"
							data={dailyUserActivitiesData.data}
							legendProps={{ verticalAlign: "bottom" }}
							xAxisProps={{ tickFormatter: (v) => dayjsLib(v).format("MMM D") }}
							series={Object.keys(dailyUserActivitiesData.series).map(
								(lot) => ({
									name: lot,
									color: MediaColors[lot],
									label: changeCase(lot),
								}),
							)}
						/>
					</>
				) : (
					<Paper withBorder h="100%" w="100%" display="flex">
						<Text m="auto" size="xl">
							No activity found in the selected period
						</Text>
					</Paper>
				)
			) : null}
		</Stack>
	);
};

const DisplayStat = (props: {
	label: string;
	value: string | number;
}) => {
	return (
		<Stack gap={4}>
			<Text size="lg" c="dimmed">
				{props.label}
			</Text>
			<Text size="xl" fw="bolder">
				{props.value}
			</Text>
		</Stack>
	);
};

const convertUTCtoLocal = (utcHour: number) => {
	const dateInUTC = dayjsLib.utc().startOf("day").hour(utcHour);
	const localTime = dateInUTC.tz(dayjsLib.tz.guess()).hour();
	return localTime;
};
