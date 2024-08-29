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
import { useInViewport } from "@mantine/hooks";
import { unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { Link, useLoaderData } from "@remix-run/react";
import {
	type CalendarEventPartFragment,
	CollectionContentsDocument,
	DailyUserActivitiesDocument,
	DailyUserActivitiesResponseGroupedBy,
	GraphqlSortOrder,
	LatestUserSummaryDocument,
	MediaLot,
	type UserPreferencesQuery,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	humanizeDuration,
	isBoolean,
	isNumber,
	mapValues,
	pickBy,
	snakeCase,
} from "@ryot/ts-utils";
import {
	IconBarbell,
	IconFriends,
	IconInfoCircle,
	IconScaleOutline,
	IconServer,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useMemo } from "react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationGrid,
	DisplayCollectionEntity,
	ProRequiredAlert,
} from "~/components/common";
import { displayWeightWithUnit } from "~/components/fitness";
import { MetadataDisplayItem } from "~/components/media";
import {
	TimeSpan,
	clientGqlService,
	dayjsLib,
	getDateFromTimeSpan,
	getLot,
	getMetadataIcon,
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

export const loader = unstable_defineLoader(async ({ request }) => {
	const preferences = await getCachedUserPreferences(request);
	const userCollectionsList = await getCachedUserCollectionsList(request);
	const takeInProgress =
		preferences.general.dashboard.inProgress.settings.numElements;
	const takeUpcoming =
		preferences.general.dashboard.upcoming.settings.numElements;
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

type DashboardSection =
	keyof UserPreferencesQuery["userPreferences"]["general"]["dashboard"];

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const theme = useMantineTheme();
	const dashboardLayoutData = useDashboardLayoutData();
	const latestUserSummary = loaderData.latestUserSummary;

	const sections = Object.entries(userPreferences.general.dashboard)
		.filter(([_, v]) => v.isHidden === false)
		.map(([section, _]) => section as DashboardSection);

	return (
		<Container>
			<Stack gap={32}>
				{dashboardLayoutData.envData.FRONTEND_DASHBOARD_MESSAGE ? (
					<Alert variant="default" icon={<IconInfoCircle />}>
						{dashboardLayoutData.envData.FRONTEND_DASHBOARD_MESSAGE}
					</Alert>
				) : null}
				{sections.map((de) =>
					match(de)
						.with("upcoming", (v) =>
							loaderData.userUpcomingCalendarEvents.length > 0 ? (
								<Section key={v} lot={v}>
									<Title>Upcoming</Title>
									<ApplicationGrid>
										{loaderData.userUpcomingCalendarEvents.map((um) => (
											<UpComingMedia um={um} key={um.calendarEventId} />
										))}
									</ApplicationGrid>
								</Section>
							) : null,
						)
						.with("inProgress", (v) =>
							loaderData.inProgressCollectionContents.results.items.length >
							0 ? (
								<Section key={v} lot={v}>
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
						.with("recommendations", (v) => (
							<Section key={v} lot={v}>
								<Title>Recommendations</Title>
								<ProRequiredAlert tooltipLabel="Get new recommendations every hour" />
							</Section>
						))
						.with("activity", (v) => (
							<Section key={v} lot={v}>
								<Title>Activity</Title>
								<ActivitySection />
							</Section>
						))
						.with("summary", (v) => (
							<Section key={v} lot={v}>
								<Title>Summary</Title>
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
												value: latestUserSummary.movieCount,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.totalMovieDuration,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Show}
										data={[
											{
												label: "Shows",
												value: latestUserSummary.showCount,
												type: "number",
											},
											{
												label: "Seasons",
												value: latestUserSummary.showSeasonCount,
												type: "number",
											},
											{
												label: "Episodes",
												value: latestUserSummary.showEpisodeCount,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.totalShowDuration,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.VideoGame}
										data={[
											{
												label: "Video games",
												value: latestUserSummary.videoGameCount,
												type: "number",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.VisualNovel}
										data={[
											{
												label: "Visual Novels",
												value: latestUserSummary.visualNovelCount,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.totalVisualNovelDuration,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.AudioBook}
										data={[
											{
												label: "Audio books",
												value: latestUserSummary.audioBookCount,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.totalAudioBookDuration,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Book}
										data={[
											{
												label: "Books",
												value: latestUserSummary.bookCount,
												type: "number",
											},
											{
												label: "Pages",
												value: latestUserSummary.totalBookPages,
												type: "number",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Podcast}
										data={[
											{
												label: "Podcasts",
												value: latestUserSummary.podcastCount,
												type: "number",
											},
											{
												label: "Runtime",
												value: latestUserSummary.totalPodcastDuration,
												type: "duration",
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Manga}
										data={[
											{
												label: "Manga",
												value: latestUserSummary.mangaCount,
												type: "number",
											},
											{
												label: "Chapters",
												value: latestUserSummary.mangaChapterCount,
												type: "number",
												hideIfZero: true,
											},
											{
												label: "Volumes",
												value: latestUserSummary.mangaVolumeCount,
												type: "number",
												hideIfZero: true,
											},
										]}
									/>
									<DisplayStatForMediaType
										lot={MediaLot.Anime}
										data={[
											{
												label: "Anime",
												value: latestUserSummary.animeCount,
												type: "number",
											},
											{
												label: "Episodes",
												value: latestUserSummary.animeEpisodeCount,
												type: "number",
												hideIfZero: true,
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
														value: latestUserSummary.totalMetadataCount,
														type: "number",
													},
													{
														label: "Reviews",
														value: latestUserSummary.totalMetadataReviewCount,
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
																label: "People Reviewed",
																value: latestUserSummary.totalPersonReviewCount,
																type: "number",
																hideIfZero: true,
															},
														]}
													/>
												</UnstyledLink>
											) : null}
										</>
									) : null}
									{userPreferences.featuresEnabled.fitness.enabled ? (
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
														value: latestUserSummary.workoutCount,
														type: "number",
													},
													{
														label: "Runtime",
														value: latestUserSummary.totalWorkoutDuration,
														type: "duration",
													},
													{
														label: "Runtime",
														value: displayWeightWithUnit(
															unitSystem,
															latestUserSummary.totalWorkoutWeight,
															true,
														),
														type: "string",
													},
												]}
											/>
										</UnstyledLink>
									) : null}
									{userPreferences.featuresEnabled.fitness.enabled ? (
										<ActualDisplayStat
											icon={<IconScaleOutline stroke={1.3} />}
											lot="Fitness"
											color={theme.colors.yellow[5]}
											data={[
												{
													label: "Measurements",
													value: latestUserSummary.measurementCount,
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
	data: Array<{
		type: "duration" | "number";
		label: string;
		value: number;
		hideIfZero?: true;
	}>;
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
	lot: DashboardSection;
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
	const { ref, inViewport } = useInViewport();
	const [timeSpan, setTimeSpan] = useLocalStorage(
		"ActivitySectionTimeSpan",
		TimeSpan.Last7Days,
	);
	const { startDate, endDate } = useMemo(() => {
		const now = dayjsLib();
		const end = now.endOf("day");
		const startDate = getDateFromTimeSpan(timeSpan);
		return {
			startDate: startDate?.format("YYYY-MM-DD"),
			endDate: end.format("YYYY-MM-DD"),
		};
	}, [timeSpan]);
	const { data: dailyUserActivitiesData } = useQuery({
		queryKey: queryFactory.miscellaneous.dailyUserActivities(startDate, endDate)
			.queryKey,
		enabled: inViewport,
		queryFn: async () => {
			const { dailyUserActivities } = await clientGqlService.request(
				DailyUserActivitiesDocument,
				{ input: { startDate, endDate } },
			);
			const trackSeries = mapValues(MediaColors, () => false);
			const data = dailyUserActivities.items.map((d) => {
				const data = Object.entries(d)
					.filter(([_, value]) => value !== 0)
					.map(([key, value]) => ({
						[snakeCase(
							key.replace("Count", "").replace("total", ""),
						).toUpperCase()]: value,
					}))
					.reduce(Object.assign, {});
				for (const key in data)
					if (isBoolean(trackSeries[key])) trackSeries[key] = true;
				return data;
			});
			const series = pickBy(trackSeries);
			return {
				data,
				series,
				groupedBy: dailyUserActivities.groupedBy,
				totalCount: dailyUserActivities.totalCount,
				totalDuration: dailyUserActivities.totalDuration,
			};
		},
	});
	const items = dailyUserActivitiesData?.totalCount || 0;

	return (
		<Stack ref={ref} pos="relative" h={{ base: 500, md: 400 }}>
			<LoadingOverlay
				visible={!dailyUserActivitiesData}
				zIndex={1000}
				overlayProps={{ radius: "md", blur: 3 }}
			/>
			<SimpleGrid cols={{ base: 2, md: 3 }} mx={{ md: "xl" }}>
				<DisplayStat
					label="Total"
					value={`${new Intl.NumberFormat("en-US", {
						notation: "compact",
					}).format(Number(items))} items`}
				/>
				<DisplayStat
					label="Duration"
					value={
						dailyUserActivitiesData
							? humanizeDuration(
									dayjsLib
										.duration(dailyUserActivitiesData.totalDuration, "minutes")
										.asMilliseconds(),
									{ largest: 2 },
								)
							: "N/A"
					}
				/>
				<Select
					label="Time span"
					defaultValue={timeSpan}
					labelProps={{ c: "dimmed" }}
					data={Object.values(TimeSpan)}
					onChange={(v) => {
						if (v) setTimeSpan(v as TimeSpan);
					}}
				/>
			</SimpleGrid>
			{dailyUserActivitiesData && dailyUserActivitiesData.totalCount !== 0 ? (
				<BarChart
					h="100%"
					ml={-15}
					withLegend
					tickLine="x"
					dataKey="DAY"
					type="stacked"
					data={dailyUserActivitiesData.data}
					legendProps={{ verticalAlign: "bottom" }}
					series={Object.keys(dailyUserActivitiesData.series).map((lot) => ({
						name: lot,
						color: MediaColors[lot],
						label: changeCase(lot),
					}))}
					xAxisProps={{
						tickFormatter: (v) =>
							dayjsLib(v).format(
								match(dailyUserActivitiesData.groupedBy)
									.with(DailyUserActivitiesResponseGroupedBy.Day, () => "MMM D")
									.with(DailyUserActivitiesResponseGroupedBy.Month, () => "MMM")
									.with(
										DailyUserActivitiesResponseGroupedBy.Year,
										DailyUserActivitiesResponseGroupedBy.Millennium,
										() => "YYYY",
									)
									.exhaustive(),
							),
					}}
				/>
			) : (
				<Paper withBorder h="100%" w="100%" display="flex">
					<Text m="auto" ta="center">
						No activity found in the selected period
					</Text>
				</Paper>
			)}
		</Stack>
	);
};

const DisplayStat = (props: {
	label: string;
	value: string | number;
}) => {
	return (
		<Stack gap={4}>
			<Text c="dimmed">{props.label}</Text>
			<Text size="xl" fw="bolder">
				{props.value}
			</Text>
		</Stack>
	);
};
