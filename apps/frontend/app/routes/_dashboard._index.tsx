import {
	ActionIcon,
	Alert,
	Box,
	Center,
	Container,
	Flex,
	Group,
	RingProgress,
	SimpleGrid,
	Stack,
	Text,
	useMantineTheme,
} from "@mantine/core";
import type {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaArgs,
} from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import {
	type CalendarEventPartFragment,
	CollectionContentsDocument,
	DailyUserActivitiesResponseGroupedBy,
	DashboardElementLot,
	GraphqlSortOrder,
	MediaLot,
	RefreshUserMetadataRecommendationsDocument,
	UserAnalyticsDocument,
	UserMetadataRecommendationsDocument,
	type UserPreferences,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	formatQuantityWithCompactNotation,
	getActionIntent,
	humanizeDuration,
	isNumber,
} from "@ryot/ts-utils";
import {
	IconBarbell,
	IconFriends,
	IconInfoCircle,
	IconRotateClockwise,
	IconScaleOutline,
	IconServer,
} from "@tabler/icons-react";
import CryptoJS from "crypto-js";
import { Fragment, type ReactNode } from "react";
import { $path } from "remix-routes";
import { ClientOnly } from "remix-utils/client-only";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { useLocalStorage } from "usehooks-ts";
import { ApplicationGrid, ProRequiredAlert } from "~/components/common";
import { DisplayCollectionEntity } from "~/components/common";
import { displayWeightWithUnit } from "~/components/fitness";
import { MetadataDisplayItem } from "~/components/media";
import {
	MediaColors,
	dayjsLib,
	getLot,
	getMetadataIcon,
	openConfirmationModal,
} from "~/lib/generals";
import {
	useConfirmSubmit,
	useCoreDetails,
	useGetMantineColors,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/hooks";
import {
	getUserCollectionsList,
	getUserPreferences,
	serverGqlService,
} from "~/lib/utilities.server";

const getTake = (preferences: UserPreferences, el: DashboardElementLot) => {
	const t = preferences.general.dashboard.find(
		(de) => de.section === el,
	)?.numElements;
	invariant(isNumber(t));
	return t;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const preferences = await getUserPreferences(request);
	const takeUpcoming = getTake(preferences, DashboardElementLot.Upcoming);
	const takeInProgress = getTake(preferences, DashboardElementLot.InProgress);
	const getRecommendations = async () => {
		if (
			preferences.general.dashboard.find(
				(de) => de.section === DashboardElementLot.Recommendations,
			)?.hidden
		)
			return [];
		const { userMetadataRecommendations } =
			await serverGqlService.authenticatedRequest(
				request,
				UserMetadataRecommendationsDocument,
			);
		return userMetadataRecommendations;
	};
	const userCollectionsList = await getUserCollectionsList(request);
	const foundInProgressCollection = userCollectionsList.find(
		(c) => c.name === "In Progress",
	);
	invariant(foundInProgressCollection);
	const [
		{ collectionContents: inProgressCollectionContents },
		userRecommendations,
		{ userUpcomingCalendarEvents },
		{ userAnalytics },
	] = await Promise.all([
		serverGqlService.authenticatedRequest(request, CollectionContentsDocument, {
			input: {
				collectionId: foundInProgressCollection.id,
				take: takeInProgress,
				sort: { order: GraphqlSortOrder.Desc },
			},
		}),
		getRecommendations(),
		serverGqlService.authenticatedRequest(
			request,
			UserUpcomingCalendarEventsDocument,
			{ input: { nextMedia: takeUpcoming } },
		),
		serverGqlService.authenticatedRequest(request, UserAnalyticsDocument, {
			input: {
				dateRange: {},
				groupBy: DailyUserActivitiesResponseGroupedBy.AllTime,
			},
		}),
	]);
	return {
		userAnalytics,
		userUpcomingCalendarEvents,
		inProgressCollectionContents,
		userRecommendations,
	};
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Home | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const intent = getActionIntent(request);
	return await match(intent)
		.with("refreshUserMetadataRecommendations", async () => {
			await serverGqlService.authenticatedRequest(
				request,
				RefreshUserMetadataRecommendationsDocument,
			);
			return {};
		})
		.run();
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const theme = useMantineTheme();
	const submit = useConfirmSubmit();

	const dashboardMessage = coreDetails.frontend.dashboardMessage;
	const latestUserSummary = loaderData.userAnalytics.activities.items.at(0);

	const [isAlertDismissed, setIsAlertDismissed] = useLocalStorage(
		`AlertDismissed-${CryptoJS.SHA256(dashboardMessage)}`,
		"false",
	);

	return (
		<Container>
			<Stack gap={32}>
				<ClientOnly>
					{() =>
						dashboardMessage && isAlertDismissed === "false" ? (
							<Alert
								withCloseButton
								variant="default"
								icon={<IconInfoCircle />}
								onClose={() => setIsAlertDismissed("true")}
							>
								{dashboardMessage}
							</Alert>
						) : null
					}
				</ClientOnly>
				{userPreferences.general.dashboard.map((de) =>
					match([de.section, de.hidden])
						.with([DashboardElementLot.Upcoming, false], ([v, _]) =>
							loaderData.userUpcomingCalendarEvents.length > 0 ? (
								<Section key={v} lot={v}>
									<SectionTitle text="Upcoming" />
									<ApplicationGrid>
										{loaderData.userUpcomingCalendarEvents.map((um) => (
											<UpComingMedia um={um} key={um.calendarEventId} />
										))}
									</ApplicationGrid>
								</Section>
							) : null,
						)
						.with([DashboardElementLot.InProgress, false], ([v, _]) =>
							loaderData.inProgressCollectionContents.results.items.length >
							0 ? (
								<Section key={v} lot={v}>
									<SectionTitle text="In Progress" />
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
						.with([DashboardElementLot.Recommendations, false], ([v, _]) => (
							<Section key={v} lot={v}>
								<Group justify="space-between">
									<SectionTitle text="Recommendations" />
									<Form
										method="POST"
										action={withQuery(".?index", {
											intent: "refreshUserMetadataRecommendations",
										})}
									>
										<ActionIcon
											type="submit"
											variant="subtle"
											onClick={(e) => {
												const form = e.currentTarget.form;
												e.preventDefault();
												openConfirmationModal(
													"Are you sure you want to refresh the recommendations?",
													() => submit(form),
												);
											}}
										>
											<IconRotateClockwise />
										</ActionIcon>
									</Form>
								</Group>
								{coreDetails.isServerKeyValidated ? (
									<ApplicationGrid>
										{loaderData.userRecommendations.map((lm) => (
											<MetadataDisplayItem key={lm} metadataId={lm} />
										))}
									</ApplicationGrid>
								) : (
									<ProRequiredAlert tooltipLabel="Get new recommendations every hour" />
								)}
							</Section>
						))
						.with([DashboardElementLot.Summary, false], ([v, _]) =>
							latestUserSummary ? (
								<Section key={v} lot={v}>
									<SectionTitle text="Summary" />
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
											lot={MediaLot.Music}
											data={[
												{
													label: "Songs",
													value: latestUserSummary.musicCount,
													type: "number",
												},
												{
													label: "Runtime",
													value: latestUserSummary.totalMusicDuration,
													type: "duration",
												},
											]}
										/>
										<DisplayStatForMediaType
											lot={MediaLot.Show}
											data={[
												{
													label: "Show episodes",
													value: latestUserSummary.showCount,
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
												{
													label: "Runtime",
													value: latestUserSummary.totalVideoGameDuration,
													type: "duration",
													hideIfZero: true,
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
																	value:
																		latestUserSummary.totalPersonReviewCount,
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
														value: latestUserSummary.userMeasurementCount,
														type: "number",
														hideIfZero: true,
													},
												]}
											/>
										) : null}
									</SimpleGrid>
								</Section>
							) : null,
						)
						.otherwise(() => undefined),
				)}
			</Stack>
		</Container>
	);
}

const SectionTitle = (props: { text: string }) => (
	<Text fz={{ base: "h2", md: "h1" }} fw="bold">
		{props.text}
	</Text>
);

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
	const colors = useGetMantineColors();

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
											formatQuantityWithCompactNotation(Number(d.value)),
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
