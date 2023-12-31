import { $path } from "@ignisda/remix-routes";
import { Box, Center, Container, Stack, Text, Title } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, snakeCase } from "@ryot/ts-utils";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, ApplicationPagination } from "~/components/common";
import { BaseDisplayItem } from "~/components/media";
import { gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const genreId = params.id ? Number(params.id) : null;
	invariant(genreId, "No ID provided");
	const [coreDetails, { genreDetails }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(GenreDetailsDocument, {
			input: { genreId, page: query.page },
		}),
	]);
	return json({
		query,
		coreDetails: { pageLimit: coreDetails.pageLimit },
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
	const [_, { setP }] = useSearchParam();

	return (
		<Container>
			<Stack>
				<Box>
					<Title id="genre-title">{loaderData.genreDetails.details.name}</Title>
					<Text>{loaderData.genreDetails.details.numItems} media items</Text>
				</Box>
				<ApplicationGrid>
					{loaderData.genreDetails.contents.items.map((media) => (
						<BaseDisplayItem
							key={media.details.identifier}
							name={media.details.title}
							bottomLeft={media.details.publishYear}
							bottomRight={changeCase(snakeCase(media.metadataLot || ""))}
							imageLink={media.details.image}
							imagePlaceholder={getInitials(media.details.title)}
							href={$path("/media/item/:id", { id: media.details.identifier })}
						/>
					))}
				</ApplicationGrid>
				<Center>
					<ApplicationPagination
						size="sm"
						defaultValue={loaderData.query.page}
						onChange={(v) => setP("page", v.toString())}
						total={Math.ceil(
							loaderData.genreDetails.contents.details.total /
								loaderData.coreDetails.pageLimit,
						)}
					/>
				</Center>
			</Stack>
		</Container>
	);
}
