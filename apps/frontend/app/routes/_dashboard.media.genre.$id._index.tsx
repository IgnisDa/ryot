import {
	Box,
	Center,
	Container,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { useLoaderData } from "@remix-run/react";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid } from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import { pageQueryParam } from "~/lib/generals";
import { useAppSearchParam, useCoreDetails } from "~/lib/hooks";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	[pageQueryParam]: zx.IntAsString.default("1"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { id: genreId } = zx.parseParams(params, { id: z.string() });
	const cookieName = await getEnhancedCookieName(`genre.${genreId}`, request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ genreDetails }] = await Promise.all([
		serverGqlService.request(GenreDetailsDocument, {
			input: { genreId, page: query[pageQueryParam] },
		}),
	]);
	return { query, genreDetails, cookieName };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.genreDetails.details.name} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
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
						value={loaderData.query[pageQueryParam]}
						onChange={(v) => setP(pageQueryParam, v.toString())}
						total={Math.ceil(
							loaderData.genreDetails.contents.details.total /
								coreDetails.pageLimit,
						)}
					/>
				</Center>
			</Stack>
		</Container>
	);
}
