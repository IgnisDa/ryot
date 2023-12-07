import { LoaderFunctionArgs } from "@remix-run/node";
import { UserExerciseDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const exerciseId = params.id as string;
	const { userExerciseDetails } = await gqlClient.request(
		UserExerciseDetailsDocument,
		{ input: { exerciseId, takeHistory: 12 } },
		await getAuthorizationHeader(request),
	);
	return userExerciseDetails.history;
};
