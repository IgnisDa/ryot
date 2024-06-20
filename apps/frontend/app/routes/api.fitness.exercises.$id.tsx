import { unstable_defineLoader } from "@remix-run/node";
import type { Params } from "@remix-run/react";
import {
	ExerciseDetailsDocument,
	UserExerciseDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { getAuthorizationHeader, gqlClient } from "~/lib/utilities.server";

async function fetchExerciseDetails(params: Params<string>, request: Request) {
	const exerciseId = params.id;
	invariant(exerciseId, "No exercise ID provided");
	const [{ exerciseDetails }, { userExerciseDetails }] = await Promise.all([
		gqlClient.request(ExerciseDetailsDocument, { exerciseId }),
		gqlClient.request(
			UserExerciseDetailsDocument,
			{ input: { exerciseId, takeHistory: 1 } },
			await getAuthorizationHeader(request),
		),
	]);
	return {
		details: { images: exerciseDetails.attributes.images },
		history: userExerciseDetails.history,
	};
}

export type LoaderReturnData = Awaited<ReturnType<typeof fetchExerciseDetails>>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const response = await fetchExerciseDetails(params, request);
	return Response.json(response);
});
