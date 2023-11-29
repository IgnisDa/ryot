import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	MetadataGroupDetailsDocument,
	UserMetadataGroupDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const metadataGroupId = params.id ? Number(params.id) : undefined;
	invariant(metadataGroupId, "No ID provided");
	const [{ metadataGroupDetails }, { userMetadataGroupDetails }] =
		await Promise.all([
			gqlClient.request(MetadataGroupDetailsDocument, { metadataGroupId }),
			gqlClient.request(
				UserMetadataGroupDetailsDocument,
				{ metadataGroupId },
				await getAuthorizationHeader(request),
			),
		]);
	return json({ metadataGroupDetails, userMetadataGroupDetails });
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).metadataGroupDetails.details.title
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
