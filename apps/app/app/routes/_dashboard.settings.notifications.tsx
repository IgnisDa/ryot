import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UserNotificationPlatformsDocument } from "@ryot/generated/graphql/backend/graphql";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [{ userNotificationPlatforms }] = await Promise.all([
		gqlClient.request(
			UserNotificationPlatformsDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return json({ userNotificationPlatforms });
};

export const meta: MetaFunction = () => {
	return [{ title: "Notification Settings | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
