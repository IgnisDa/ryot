import {
	Box,
	Center,
	Container,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import {
	parseParameters,
	parseSearchQuery,
	zodIntAsString,
} from "@ryot/ts-utils";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { pageQueryParam } from "~/lib/shared/constants";
import { useAppSearchParam } from "~/lib/shared/hooks";
import {
	getSearchEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.media.genre.$id._index";

const searchParamsSchema = z.object({
	[pageQueryParam]: zodIntAsString.default("1"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { id: genreId } = parseParameters(params, z.object({ id: z.string() }));
	const cookieName = await getSearchEnhancedCookieName(
		`genre.${genreId}`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	const [{ genreDetails }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, GenreDetailsDocument, {
			input: { genreId, page: query[pageQueryParam] },
		}),
	]);
	const totalPages = await redirectToFirstPageIfOnInvalidPage({
		request,
		currentPage: query[pageQueryParam],
		totalResults: genreDetails.contents.details.total,
	});
	return { query, genreDetails, cookieName, totalPages };
};

export const meta = ({ data }: Route.MetaArgs) => {
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
