import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseParametersDocument,
	ExerciseSortBy,
	ExercisesListDocument,
	GraphqlSortOrder,
} from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";

const defaultFiltersValue = {
	sort: ExerciseSortBy.LastPerformed,
	order: GraphqlSortOrder.Desc,
};

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
	sortBy: z.nativeEnum(ExerciseSortBy).default(defaultFiltersValue.sort),
	type: z.nativeEnum(ExerciseLot).optional(),
	level: z.nativeEnum(ExerciseLevel).optional(),
	force: z.nativeEnum(ExerciseForce).optional(),
	mechanic: z.nativeEnum(ExerciseMechanic).optional(),
	equipment: z.nativeEnum(ExerciseEquipment).optional(),
	muscle: z.nativeEnum(ExerciseMuscle).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [
		coreDetails,
		userPreferences,
		{ exerciseParameters },
		{ exercisesList },
	] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
		gqlClient.request(ExerciseParametersDocument, {}),
		gqlClient.request(
			ExercisesListDocument,
			{
				input: {
					search: {
						page: query.page,
						query: query.query,
					},
					filter: {
						equipment: query.equipment,
						force: query.force,
						level: query.level,
						mechanic: query.mechanic,
						muscle: query.muscle,
						type: query.type,
					},
					sortBy: query.sortBy,
				},
			},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		coreDetails,
		userPreferences,
		query,
		exerciseParameters,
		exercisesList,
	});
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
