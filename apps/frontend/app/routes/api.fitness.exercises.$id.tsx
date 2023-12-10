import { LoaderFunctionArgs } from "@remix-run/node";
import { UserExerciseDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const exerciseId = params.id;
	invariant(exerciseId, "No exercise ID provided");
	const { userExerciseDetails } = await gqlClient.request(
		UserExerciseDetailsDocument,
		{ input: { exerciseId, takeHistory: 1 } },
		await getAuthorizationHeader(request),
	);
	return userExerciseDetails.history;
};
