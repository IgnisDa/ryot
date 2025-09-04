import {
	ActionIcon,
	Alert,
	Button,
	Container,
	Drawer,
	Group,
	Stack,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	type CalendarEventPartFragment,
	CollectionContentsDocument,
	CollectionContentsSortBy,
	DailyUserActivitiesResponseGroupedBy,
	DashboardElementLot,
	GraphqlSortOrder,
	MediaLot,
	MinimalUserAnalyticsDocument,
	TrendingMetadataDocument,
	UserMetadataRecommendationsDocument,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, parseSearchQuery, zodBoolAsString } from "@ryot/ts-utils";
import {
	IconInfoCircle,
	IconPlayerPlay,
	IconRotateClockwise,
} from "@tabler/icons-react";
import { skipToken, useQuery } from "@tanstack/react-query";
import CryptoJS from "crypto-js";
import type { ReactNode } from "react";
import { redirect } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { ProRequiredAlert, SkeletonLoader } from "~/components/common";
import { DisplayCollectionEntity } from "~/components/common";
import { ApplicationGrid } from "~/components/common/layout";
import { DisplaySummarySection } from "~/components/common/summary";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useExpireCacheKeyMutation,
	useIsMobile,
	useIsOnboardingTourCompleted,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { useOnboardingTour } from "~/lib/state/onboarding-tour";
import { getUserPreferences } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard._index";

const searchParamsSchema = z.object({
	ignoreLandingPath: zodBoolAsString.optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const preferences = await getUserPreferences(request);
	const query = parseSearchQuery(request, searchParamsSchema);
	const landingPath = preferences.general.landingPath;
	if (landingPath !== "/" && !query.ignoreLandingPath)
		throw redirect(landingPath);
	return {};
};

export const meta = () => {
	return [{ title: "Dashboard | Ryot" }];
};

export default function Page() {
	const isMobile = useIsMobile();
	const coreDetails = useCoreDetails();
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const { startOnboardingTour } = useOnboardingTour();
	const isOnboardingTourCompleted = useIsOnboardingTourCompleted();

	const dashboardMessage = coreDetails.frontend.dashboardMessage;

	const getTake = (el: DashboardElementLot) => {
		const t = userPreferences.general.dashboard.find(
			(de) => de.section === el,
		)?.numElements;
		return isNumber(t) ? t : 10;
	};
	const takeUpcoming = getTake(DashboardElementLot.Upcoming);
	const takeInProgress = getTake(DashboardElementLot.InProgress);

	const userCollections = useUserCollections();

	const inProgressCollection = userCollections.find(
		(c) => c.name === "In Progress",
	);

	const inProgressCollectionContentsQuery = useQuery({
		queryKey: queryFactory.collections.collectionContents({
			search: { take: takeInProgress },
			collectionId: inProgressCollection?.id || "",
			sort: {
				order: GraphqlSortOrder.Desc,
				by: CollectionContentsSortBy.LastUpdatedOn,
			},
		}).queryKey,
		queryFn: inProgressCollection?.id
			? () =>
					clientGqlService.request(CollectionContentsDocument, {
						input: {
							search: { take: takeInProgress },
							collectionId: inProgressCollection.id,
							sort: {
								order: GraphqlSortOrder.Desc,
								by: CollectionContentsSortBy.LastUpdatedOn,
							},
						},
					})
			: skipToken,
	});

	const userUpcomingCalendarEventsQuery = useQuery({
		queryKey: queryFactory.calendar.userUpcomingCalendarEvents({
			nextMedia: takeUpcoming,
		}).queryKey,
		queryFn: () =>
			clientGqlService.request(UserUpcomingCalendarEventsDocument, {
				input: { nextMedia: takeUpcoming },
			}),
	});

	const userAnalyticsQuery = useQuery({
		queryKey: queryFactory.miscellaneous.userAnalytics({
			dateRange: {},
			groupBy: DailyUserActivitiesResponseGroupedBy.AllTime,
		}).queryKey,
		queryFn: () =>
			clientGqlService.request(MinimalUserAnalyticsDocument, {
				input: {
					dateRange: {},
					groupBy: DailyUserActivitiesResponseGroupedBy.AllTime,
				},
			}),
	});

	const latestUserSummary =
		userAnalyticsQuery.data?.userAnalytics.response.activities.items.at(0);

	const [isAlertDismissed, setIsAlertDismissed] = useLocalStorage(
		`AlertDismissed-${userDetails.id}-${CryptoJS.SHA256(dashboardMessage)}`,
		"false",
	);

	return (
		<Container>
			<Stack gap={32}>
				<ClientOnly>
					{() => (
						<>
							{dashboardMessage && isAlertDismissed === "false" ? (
								<Alert
									withCloseButton
									variant="default"
									icon={<IconInfoCircle />}
									onClose={() => setIsAlertDismissed("true")}
								>
									{dashboardMessage}
								</Alert>
							) : null}
							{!isOnboardingTourCompleted && !isMobile ? (
								<Alert
									variant="filled"
									icon={<IconPlayerPlay />}
									style={{ cursor: "pointer" }}
									onClick={startOnboardingTour}
								>
									Welcome to Ryot! Click here to start your onboarding tour.
								</Alert>
							) : null}
						</>
					)}
				</ClientOnly>
				{userPreferences.general.dashboard.map((de) =>
					match([de.section, de.hidden])
						.with([DashboardElementLot.Upcoming, false], ([v, _]) => (
							<Section key={v} lot={v}>
								<SectionTitle text="Upcoming" />
								{userUpcomingCalendarEventsQuery.data ? (
									userUpcomingCalendarEventsQuery.data
										.userUpcomingCalendarEvents.length > 0 ? (
										<ApplicationGrid>
											{userUpcomingCalendarEventsQuery.data.userUpcomingCalendarEvents.map(
												(um) => (
													<UpcomingMediaSection
														um={um}
														key={um.calendarEventId}
													/>
												),
											)}
										</ApplicationGrid>
									) : (
										<Text c="dimmed">No media upcoming.</Text>
									)
								) : (
									<SkeletonLoader />
								)}
							</Section>
						))
						.with([DashboardElementLot.InProgress, false], ([v, _]) => (
							<Section key={v} lot={v}>
								<SectionTitle text="In Progress" />
								{inProgressCollectionContentsQuery.data ? (
									inProgressCollectionContentsQuery.data.collectionContents
										.response.results.items.length > 0 ? (
										<ApplicationGrid>
											{inProgressCollectionContentsQuery.data.collectionContents.response.results.items.map(
												(lm) => (
													<DisplayCollectionEntity
														key={lm.entityId}
														entityId={lm.entityId}
														entityLot={lm.entityLot}
													/>
												),
											)}
										</ApplicationGrid>
									) : (
										<Text c="dimmed">No media in progress.</Text>
									)
								) : (
									<SkeletonLoader />
								)}
							</Section>
						))
						.with([DashboardElementLot.Recommendations, false], ([v, _]) => (
							<Section key={v} lot={v}>
								<RecommendationsSection />
							</Section>
						))
						.with([DashboardElementLot.Summary, false], ([v, _]) => (
							<Section key={v} lot={v}>
								<SectionTitle text="Summary" />
								{userAnalyticsQuery.data ? (
									latestUserSummary ? (
										<DisplaySummarySection
											latestUserSummary={latestUserSummary}
										/>
									) : (
										<Text c="dimmed">
											No summary available. Please add some media to your
											watched history.
										</Text>
									)
								) : (
									<SkeletonLoader />
								)}
							</Section>
						))
						.with([DashboardElementLot.Trending, false], ([v, _]) => (
							<Section key={v} lot={v}>
								<TrendingSection />
							</Section>
						))
						.otherwise(() => undefined),
				)}
			</Stack>
		</Container>
	);
}

const RecommendationsSection = () => {
	const coreDetails = useCoreDetails();

	const expireCacheKey = useExpireCacheKeyMutation();
	const { data, refetch } = useQuery({
		queryKey: queryFactory.media.userMetadataRecommendations().queryKey,
		queryFn: () =>
			clientGqlService.request(UserMetadataRecommendationsDocument),
	});

	return (
		<>
			<Group justify="space-between">
				<SectionTitle text="Recommendations" />
				{data ? (
					<ActionIcon
						variant="subtle"
						onClick={() => {
							openConfirmationModal(
								"Are you sure you want to refresh the recommendations?",
								async () => {
									await expireCacheKey.mutateAsync(
										data.userMetadataRecommendations.cacheId,
									);
									refetch();
								},
							);
						}}
					>
						<IconRotateClockwise />
					</ActionIcon>
				) : null}
			</Group>
			{data ? (
				coreDetails.isServerKeyValidated ? (
					data.userMetadataRecommendations.response.length > 0 ? (
						<ApplicationGrid>
							{data.userMetadataRecommendations.response.map((lm) => (
								<MetadataDisplayItem
									key={lm}
									metadataId={lm}
									shouldHighlightNameIfInteracted
								/>
							))}
						</ApplicationGrid>
					) : (
						<Text c="dimmed">No recommendations available.</Text>
					)
				) : (
					<ProRequiredAlert tooltipLabel="Get new recommendations every hour" />
				)
			) : (
				<SkeletonLoader />
			)}
		</>
	);
};

const TrendingSection = () => {
	const userPreferences = useUserPreferences();

	const [isTrendingMetadataListOpen, { toggle: toggleTrendingMetadataList }] =
		useDisclosure(false);

	const trendingMetadata = useQuery({
		queryKey: queryFactory.media.trendingMetadata().queryKey,
		queryFn: () => clientGqlService.request(TrendingMetadataDocument),
	});

	const trendingMetadataSelection =
		trendingMetadata.data?.trendingMetadata.slice(
			0,
			userPreferences.general.dashboard.find(
				(de) => de.section === DashboardElementLot.Trending,
			)?.numElements || 1,
		);

	return (
		<>
			<Drawer
				size="xl"
				position="right"
				title="Trending Media"
				opened={isTrendingMetadataListOpen}
				onClose={toggleTrendingMetadataList}
			>
				{trendingMetadata.data ? (
					<ApplicationGrid>
						{trendingMetadata.data.trendingMetadata.map((lm) => (
							<MetadataDisplayItem
								key={lm}
								metadataId={lm}
								shouldHighlightNameIfInteracted
							/>
						))}
					</ApplicationGrid>
				) : (
					<SkeletonLoader />
				)}
			</Drawer>
			<Group justify="space-between">
				<SectionTitle text="Trending" />
				{trendingMetadata.data &&
				trendingMetadataSelection &&
				trendingMetadata.data.trendingMetadata.length >
					trendingMetadataSelection.length ? (
					<Button
						size="xs"
						variant="subtle"
						onClick={toggleTrendingMetadataList}
					>
						View All
					</Button>
				) : null}
			</Group>
			{trendingMetadataSelection ? (
				trendingMetadataSelection.length > 0 ? (
					<ApplicationGrid>
						{trendingMetadataSelection.map((lm) => (
							<MetadataDisplayItem
								key={lm}
								metadataId={lm}
								shouldHighlightNameIfInteracted
							/>
						))}
					</ApplicationGrid>
				) : (
					<Text c="dimmed">No trending media available.</Text>
				)
			) : (
				<SkeletonLoader />
			)}
		</>
	);
};

const SectionTitle = (props: { text: string }) => (
	<Text fz={{ base: "h2", md: "h1" }} fw="bold">
		{props.text}
	</Text>
);

const UpcomingMediaSection = (props: { um: CalendarEventPartFragment }) => {
	const today = dayjsLib().startOf("day");
	const numDaysLeft = dayjsLib(props.um.date).diff(today, "day");

	return (
		<MetadataDisplayItem
			noLeftLabel
			altName={props.um.metadataText}
			metadataId={props.um.metadataId}
			rightLabel={`${match(props.um.metadataLot)
				.with(
					MediaLot.Show,
					() =>
						`S${props.um.showExtraInformation?.season}-E${props.um.showExtraInformation?.episode}`,
				)
				.with(
					MediaLot.Podcast,
					() => `EP-${props.um.podcastExtraInformation?.episode}`,
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
