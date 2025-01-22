import {
	ActionIcon,
	Alert,
	Container,
	Group,
	Stack,
	Text,
} from "@mantine/core";
import type {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaArgs,
} from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import {
	type CalendarEventPartFragment,
	CollectionContentsDocument,
	DailyUserActivitiesResponseGroupedBy,
	DashboardElementLot,
	GraphqlSortOrder,
	MediaLot,
	UserAnalyticsDocument,
	UserMetadataRecommendationsDocument,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber } from "@ryot/ts-utils";
import { IconInfoCircle, IconRotateClockwise } from "@tabler/icons-react";
import CryptoJS from "crypto-js";
import type { ReactNode } from "react";
import { ClientOnly } from "remix-utils/client-only";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationGrid,
	DisplaySummarySection,
	ProRequiredAlert,
} from "~/components/common";
import { DisplayCollectionEntity } from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import {
	clientGqlService,
	dayjsLib,
	openConfirmationModal,
} from "~/lib/generals";
import { useCoreDetails, useUserPreferences } from "~/lib/hooks";
import {
	getUserCollectionsList,
	getUserPreferences,
	serverGqlService,
} from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const preferences = await getUserPreferences(request);
	const getTake = (el: DashboardElementLot) => {
		const t = preferences.general.dashboard.find(
			(de) => de.section === el,
		)?.numElements;
		invariant(isNumber(t));
		return t;
	};
	const takeUpcoming = getTake(DashboardElementLot.Upcoming);
	const takeInProgress = getTake(DashboardElementLot.InProgress);
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
				{},
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
				search: { take: takeInProgress },
				sort: { order: GraphqlSortOrder.Desc },
				collectionId: foundInProgressCollection.id,
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

export const action = async (_args: ActionFunctionArgs) => {};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const revalidator = useRevalidator();

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
									<ActionIcon
										variant="subtle"
										onClick={() => {
											openConfirmationModal(
												"Are you sure you want to refresh the recommendations?",
												async () => {
													await clientGqlService.request(
														UserMetadataRecommendationsDocument,
														{ shouldRefresh: true },
													);
													revalidator.revalidate();
												},
											);
										}}
									>
										<IconRotateClockwise />
									</ActionIcon>
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
									<DisplaySummarySection
										latestUserSummary={latestUserSummary}
									/>
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
