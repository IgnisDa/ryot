import {
	Box,
	Center,
	Container,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { parseRequestSearchQuery, zodIntAsString } from "@ryot/ts-utils";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid } from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import { pageQueryParam } from "~/lib/generals";
import { useAppSearchParam } from "~/lib/hooks";
import {
	getEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	[pageQueryParam]: zodIntAsString.default("1"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const { id: genreId } = zx.parseParams(params, { id: z.string() });
	const cookieName = await getEnhancedCookieName(`genre.${genreId}`, request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseRequestSearchQuery(request, searchParamsSchema);
	const [{ genreDetails }] = await Promise.all([
		serverGqlService.request(GenreDetailsDocument, {
			input: { genreId, page: query[pageQueryParam] },
		}),
	]);
	const totalPages = await redirectToFirstPageIfOnInvalidPage(
		request,
		genreDetails.contents.details.total,
		query[pageQueryParam],
	);
	return { query, genreDetails, cookieName, totalPages };
};

export const meta = ({ data }: MetaArgs<typeof loader>) => {
	return [{ title: `${data?.genreDetails.details.name} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	return (
		<Container>
			<Stack>
				<Box>
					<Title id="genre-title">{loaderData.genreDetails.details.name}</Title>
					<Text>{loaderData.genreDetails.details.numItems} media items</Text>
				</Box>
				<ApplicationGrid>
					{loaderData.genreDetails.contents.items.map((media) => (
						<MetadataDisplayItem key={media} metadataId={media} />
					))}
				</ApplicationGrid>
				<Center>
					<Pagination
						size="sm"
						total={loaderData.totalPages}
						value={loaderData.query[pageQueryParam]}
						onChange={(v) => setP(pageQueryParam, v.toString())}
					/>
				</Center>
			</Stack>
		</Container>
	);
}
