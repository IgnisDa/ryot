import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { MetadataGroupsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import { gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { metadataGroupsList }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(MetadataGroupsListDocument, {
			input: { page: query.page, query: query.query },
		}),
	]);
	return json({ coreDetails, query, metadataGroupsList });
};

export const meta: MetaFunction = () => {
	return [{ title: "Groups | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
