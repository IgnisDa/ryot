import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const genreId = params.id ? Number(params.id) : undefined;
	invariant(genreId, "No ID provided");
	const [coreDetails, { genreDetails }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(GenreDetailsDocument, {
			input: { genreId, page: query.page },
		}),
	]);
	return json({
		coreDetails,
		genreDetails,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).genreDetails.details.name
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
