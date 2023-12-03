import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, userPreferences] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
	]);
	return json({ coreDetails, userPreferences });
};

export const meta: MetaFunction = () => {
	return [{ title: "Preference | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
