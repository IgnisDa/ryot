import { LoaderFunctionArgs } from "@remix-run/node";
import { UserExerciseDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

const searchParamsSchema = z.object({
	exerciseId: z.string(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const { userExerciseDetails } = await gqlClient.request(
		UserExerciseDetailsDocument,
		{ input: { exerciseId: query.exerciseId, takeHistory: 12 } },
		await getAuthorizationHeader(request),
	);
	return userExerciseDetails.history;
};
