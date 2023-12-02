import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getCoreDetails, getUserDetails } from "~/lib/graphql.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, userDetails] = await Promise.all([
		getCoreDetails(),
		getUserDetails(request),
	]);
	return json({
		coreDetails,
		userDetails,
	});
}

export const meta: MetaFunction = () => {
	return [{ title: "Profile Settings | Ryot" }];
};
;

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
