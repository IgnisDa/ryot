import { LoaderFunctionArgs } from "@remix-run/node";
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
	);
	const collectionId = userCollectionsList[0].id;
	const { collectionContents } = await gqlClient.request(
		CollectionContentsDocument,
		{
			input: { collectionId, take, sort: { order: GraphqlSortOrder.Desc } },
		},
	);
};

export default function Index() {
	return (
		<div>
			<h1>Wow this is perfect!</h1>
			<p>Does it work?</p>
		</div>
	);
}
