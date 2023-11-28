import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	ExerciseDetailsDocument,
	UserExerciseDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getUserPreferences } from "~/lib/graphql.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
	const exerciseId = params.id;
	invariant(typeof exerciseId === "string", "id must be a string");
	const [userPreferences, { exerciseDetails }, { userExerciseDetails }] =
		await Promise.all([
			getUserPreferences(request),
			gqlClient.request(ExerciseDetailsDocument, { exerciseId }),
			gqlClient.request(
				UserExerciseDetailsDocument,
				{ input: { exerciseId } },
				await getAuthorizationHeader(request),
			),
		]);
	return json({
		exerciseDetails,
		userExerciseDetails,
		userPreferences,
		exerciseId,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).exerciseDetails.id
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
