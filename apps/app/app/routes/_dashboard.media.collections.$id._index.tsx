import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	EntityLot,
	GraphqlSortOrder,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.optional(),
	query: z.string().optional(),
	sortBy: z.nativeEnum(CollectionContentsSortBy).optional(),
	orderBy: z.nativeEnum(GraphqlSortOrder).optional(),
	entityLot: z.nativeEnum(EntityLot).optional(),
	metadataLot: z.nativeEnum(MetadataLot).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const id = params.id ? Number(params.id) : undefined;
	invariant(id, "No ID provided");
	const query = zx.parseQuery(request, searchParamsSchema);
	const { collectionContents: details } = await gqlClient.request(
		CollectionContentsDocument,
		{ input: { collectionId: id, take: 0 } },
		await getAuthorizationHeader(request),
	);
	const { collectionContents: contents } = await gqlClient.request(
		CollectionContentsDocument,
		{
			input: {
				collectionId: id,
				filter: {
					entityType: query.entityLot,
					metadataLot: query.metadataLot,
				},
				sort: { by: query.sortBy, order: query.orderBy },
				search: {
					page: query.page,
					query: query.query,
				},
			},
		},
		await getAuthorizationHeader(request),
	);
	return json({ id, details, contents: contents.results });
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
