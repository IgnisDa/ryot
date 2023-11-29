import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { WorkoutDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const workoutId = params.id;
	invariant(workoutId, "No ID provided");
	const [{ workoutDetails }] = await Promise.all([
		gqlClient.request(
			WorkoutDetailsDocument,
			{ workoutId },
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		workoutId,
		workoutDetails,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).workoutDetails.name
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
