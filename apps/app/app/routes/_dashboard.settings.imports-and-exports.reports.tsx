import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ImportReportsDocument } from "@ryot/generated/graphql/backend/graphql";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [{ importReports }] = await Promise.all([
		gqlClient.request(
			ImportReportsDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return json({ importReports });
};

export const meta: MetaFunction = () => {
	return [{ title: "Import Reports | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
