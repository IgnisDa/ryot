import { LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	CollectionContentsDocument,
	DashboardElementLot,
	GraphqlSortOrder,
	LatestUserSummaryDocument,
	UserCollectionsListDocument,
	UserUpcomingCalendarEventsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getUserPreferences } from "~/lib/graphql.server";

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

export default function Index() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<div>
			<div>{JSON.stringify(loaderData)}</div>
		</div>
	);
}
