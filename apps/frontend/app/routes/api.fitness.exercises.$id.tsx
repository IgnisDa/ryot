import { LoaderFunctionArgs } from "@remix-run/node";
import {
	ExerciseDetailsDocument,
	UserExerciseDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
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
		details: {
			images: exerciseDetails.attributes.images,
		},
		history: userExerciseDetails.history,
	};
};
