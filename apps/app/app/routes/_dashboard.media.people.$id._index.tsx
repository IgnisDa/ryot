import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	PersonDetailsDocument,
	UserCollectionsListDocument,
	UserPersonDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import {
	getCoreDetails,
	getUserDetails,
	getUserPreferences,
} from "~/lib/graphql.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const personId = params.id ? Number(params.id) : undefined;
	invariant(personId, "No ID provided");
	const [
		coreDetails,
		userPreferences,
		userDetails,
		{ personDetails },
		{ userPersonDetails },
		{ userCollectionsList: collections },
	] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
		getUserDetails(request),
		gqlClient.request(PersonDetailsDocument, { personId }),
		gqlClient.request(
			UserPersonDetailsDocument,
			{ personId },
			await getAuthorizationHeader(request),
		),
		gqlClient.request(
			UserCollectionsListDocument,
			{},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		coreDetails,
		userPreferences,
		userDetails,
		collections,
		personId,
		userPersonDetails,
		personDetails,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).personDetails.details.name
			} | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
