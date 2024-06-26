import { $path } from "@ignisda/remix-routes";
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
import { changeCase, getInitials, snakeCase } from "@ryot/ts-utils";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid } from "~/components/common";
import { BaseDisplayItem } from "~/components/media";
import { useCoreDetails, useSearchParam } from "~/lib/hooks";
import { serverGqlService } from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const genreId = params.id;
	invariant(genreId);
	const [{ genreDetails }] = await Promise.all([
		serverGqlService.request(GenreDetailsDocument, {
			input: { genreId, page: query.page },
		}),
	]);
	return { query, genreDetails };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.genreDetails.details.name} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
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
					<Pagination
						size="sm"
						value={loaderData.query.page}
						onChange={(v) => setP("page", v.toString())}
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
