import {
	ActionIcon,
	Alert,
	Button,
	Container,
	Drawer,
	Group,
	Skeleton,
	Stack,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	type CalendarEventPartFragment,
	CollectionContentsDocument,
	DailyUserActivitiesResponseGroupedBy,
	DashboardElementLot,
	ExpireCacheKeyDocument,
	GraphqlSortOrder,
	MediaLot,
	MinimalUserAnalyticsDocument,
	TrendingMetadataDocument,
	UserMetadataRecommendationsDocument,
	type UserPreferences,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, parseSearchQuery, zodBoolAsString } from "@ryot/ts-utils";
import {
	IconInfoCircle,
	IconPlayerPlay,
	IconRotateClockwise,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import CryptoJS from "crypto-js";
import type { ReactNode } from "react";
import { redirect, useLoaderData } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
	ApplicationGrid,
	DisplaySummarySection,
	ProRequiredAlert,
} from "~/components/common";
import { DisplayCollectionEntity } from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useIsMobile,
	useIsOnboardingTourCompleted,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/query-factory";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { useOnboardingTour } from "~/lib/state/general";
import {
	getUserCollectionsList,
	getUserPreferences,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard._index";

const searchParamsSchema = z.object({
	ignoreLandingPath: zodBoolAsString.optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

const redirectToLandingPath = (
	request: Request,
	preferences: UserPreferences,
) => {
	const query = parseSearchQuery(request, searchParamsSchema);
	const landingPath = preferences.general.landingPath;
	if (landingPath === "/" || query.ignoreLandingPath) return;
	throw redirect(landingPath);
};

export const loader = async ({ request }: Route.LoaderArgs) => {
	const preferences = await getUserPreferences(request);
	redirectToLandingPath(request, preferences);
	const getTake = (el: DashboardElementLot) => {
		const t = preferences.general.dashboard.find(
			(de) => de.section === el,
		)?.numElements;
		invariant(isNumber(t));
		return t;
	};
	const takeUpcoming = getTake(DashboardElementLot.Upcoming);
	const takeInProgress = getTake(DashboardElementLot.InProgress);
	const userCollectionsList = await getUserCollectionsList(request);
	const foundInProgressCollection = userCollectionsList.find(
		(c) => c.name === "In Progress",
	);
	invariant(foundInProgressCollection);
	const [
		{ collectionContents: inProgressCollectionContents },
		{ userUpcomingCalendarEvents },
		{ userAnalytics },
	] = await Promise.all([
		serverGqlService.authenticatedRequest(request, CollectionContentsDocument, {
			input: {
				search: { take: takeInProgress },
				sort: { order: GraphqlSortOrder.Desc },
				collectionId: foundInProgressCollection.id,
			},
		}),
		serverGqlService.authenticatedRequest(
			request,
			UserUpcomingCalendarEventsDocument,
			{ input: { nextMedia: takeUpcoming } },
		),
		serverGqlService.authenticatedRequest(
			request,
			MinimalUserAnalyticsDocument,
			{
				input: {
					dateRange: {},
					groupBy: DailyUserActivitiesResponseGroupedBy.AllTime,
				},
			},
		),
	]);
	return {
		userAnalytics,
		userUpcomingCalendarEvents,
		inProgressCollectionContents,
	};
};

export const meta = () => {
	return [{ title: "Dashboard | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const userDetails = useUserDetails();
	const { startOnboardingTour } = useOnboardingTour();
	const isMobile = useIsMobile();
	const isOnboardingTourCompleted = useIsOnboardingTourCompleted();

	const dashboardMessage = coreDetails.frontend.dashboardMessage;
	const latestUserSummary = loaderData.userAnalytics.activities.items.at(0);

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
						.with([DashboardElementLot.InProgress, false], ([v, _]) => (
							<Section key={v} lot={v}>
								<SectionTitle text="In Progress" />
								{loaderData.inProgressCollectionContents.response.results.items
									.length > 0 ? (
									<ApplicationGrid>
										{loaderData.inProgressCollectionContents.response.results.items.map(
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
								{latestUserSummary ? (
									<DisplaySummarySection
										latestUserSummary={latestUserSummary}
									/>
								) : (
									<Text c="dimmed">
										No summary available. Please add some media to your watched
										history.
									</Text>
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

	const recommendations = useQuery({
		queryKey: queryFactory.media.userMetadataRecommendations().queryKey,
		queryFn: () =>
			clientGqlService.request(UserMetadataRecommendationsDocument),
	});

	const expireCacheKey = useMutation({
		mutationFn: () =>
			clientGqlService.request(ExpireCacheKeyDocument, {
				cacheId:
					recommendations.data?.userMetadataRecommendations.cacheId ?? "",
			}),
	});

	return (
		<>
			<Group justify="space-between">
				<SectionTitle text="Recommendations" />
				<ActionIcon
					variant="subtle"
					onClick={() => {
						openConfirmationModal(
							"Are you sure you want to refresh the recommendations?",
							async () => {
								await expireCacheKey.mutateAsync();
								recommendations.refetch();
							},
						);
					}}
				>
					<IconRotateClockwise />
				</ActionIcon>
			</Group>
			{recommendations.data ? (
				coreDetails.isServerKeyValidated ? (
					recommendations.data.userMetadataRecommendations.response.length >
					0 ? (
						<ApplicationGrid>
							{recommendations.data.userMetadataRecommendations.response.map(
								(lm) => (
									<MetadataDisplayItem
										key={lm}
										metadataId={lm}
										shouldHighlightNameIfInteracted
									/>
								),
							)}
						</ApplicationGrid>
					) : (
						<Text c="dimmed">No recommendations available.</Text>
					)
				) : (
					<ProRequiredAlert tooltipLabel="Get new recommendations every hour" />
				)
			) : (
				<Skeleton height={100} />
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
			{isTrendingMetadataListOpen ? (
				<Drawer
					size="xl"
					position="right"
					title="Trending Media"
					opened={isTrendingMetadataListOpen}
					onClose={toggleTrendingMetadataList}
				>
					<ApplicationGrid>
						{trendingMetadata.data?.trendingMetadata.map((lm) => (
							<MetadataDisplayItem
								key={lm}
								metadataId={lm}
								shouldHighlightNameIfInteracted
							/>
						))}
					</ApplicationGrid>
				</Drawer>
			) : null}
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
				<Skeleton height={100} />
			)}
		</>
	);
};

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
			noLeftLabel
			altName={um.metadataText}
			metadataId={um.metadataId}
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
