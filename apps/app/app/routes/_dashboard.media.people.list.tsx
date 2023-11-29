import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	GraphqlSortOrder,
	PeopleListDocument,
	PersonSortBy,
} from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import { gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";

const defaultFilters = {
	sortBy: PersonSortBy.MediaItems,
	sortOrder: GraphqlSortOrder.Desc,
};

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
	sortBy: z.nativeEnum(PersonSortBy).default(defaultFilters.sortBy),
	orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFilters.sortOrder),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { peopleList }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(PeopleListDocument, {
			input: {
				search: { page: query.page, query: query.query },
				sort: { by: query.sortBy, order: query.orderBy },
			},
		}),
	]);
	return json({
		coreDetails,
		peopleList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "People | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
