import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UsersListDocument } from "@ryot/generated/graphql/backend/graphql";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, usersList] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(
			UsersListDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return json({ coreDetails, usersList });
};

export const meta: MetaFunction = () => {
	return [{ title: "User Settings | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
