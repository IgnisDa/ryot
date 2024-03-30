import { $path } from "@ignisda/remix-routes";
import {
	Box,
	Center,
	Container,
	Flex,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	MediaSource,
	MetadataGroupSearchDocument,
	MetadataGroupsListDocument,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, snakeCase } from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	ApplicationPagination,
	DebouncedSearchInput,
} from "~/components/common";
import { BaseDisplayItem } from "~/components/media";
import { useSearchParam } from "~/lib/hooks";
import {
	getAuthorizationHeader,
	getCoreDetails,
	gqlClient,
} from "~/lib/utilities.server";

export type SearchParams = {
	query?: string;
};

enum Action {
	List = "list",
	Search = "search",
}

const SEARCH_SOURCES_ALLOWED = [
	[MediaSource.Tmdb, MetadataLot.Movie],
	[MediaSource.Igdb, MetadataLot.VideoGame],
] as const;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const action = params.action as Action;
	const { query, page } = zx.parseQuery(request, {
		query: z.string().optional(),
		page: zx.IntAsString.default("1"),
	});
	const coreDetails = await getCoreDetails(request);
	const [list, search] = await match(action)
		.with(Action.List, async () => {
			const { metadataGroupsList } = await gqlClient.request(
				MetadataGroupsListDocument,
				{ input: { page, query } },
				await getAuthorizationHeader(request),
			);
			return [{ list: metadataGroupsList, url: {} }, undefined] as const;
		})
		.with(Action.Search, async () => {
			const urlParse = zx.parseQuery(
				request,
				z.object({
					source: z.nativeEnum(MediaSource).default(MediaSource.Tmdb),
					lot: z.nativeEnum(MetadataLot).default(MetadataLot.Movie),
				}),
			);
			const { metadataGroupSearch } = await gqlClient.request(
				MetadataGroupSearchDocument,
				{
					input: {
						lot: urlParse.lot,
						source: urlParse.source,
						search: { page, query },
					},
				},
				await getAuthorizationHeader(request),
			);
			return [
				undefined,
				{ search: metadataGroupSearch, url: urlParse },
			] as const;
		})
		.exhaustive();
	return json({
		action,
		coreDetails: { pageLimit: coreDetails.pageLimit },
		query,
		page,
		list,
		search,
	});
};

export const meta: MetaFunction = ({ params }) => {
	return [
		{
			title: `${changeCase(params.action || "")} Groups | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useSearchParam();

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Groups</Title>
				</Flex>
				<DebouncedSearchInput
					placeholder="Search for groups"
					initialValue={loaderData.query}
				/>
				{loaderData.list && (loaderData.list.list.details.total || 0) > 0 ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.list.list.details.total}
							</Text>{" "}
							items found
						</Box>
						<ApplicationGrid>
							{loaderData.list.list.items.map((group) => (
								<BaseDisplayItem
									name={group.title}
									bottomLeft={`${group.parts} items`}
									bottomRight={changeCase(snakeCase(group.lot))}
									imageLink={group.image}
									imagePlaceholder={getInitials(group.title)}
									key={group.id}
									href={$path("/media/groups/item/:id", { id: group.id })}
								/>
							))}
						</ApplicationGrid>
					</>
				) : (
					<Text>No information to display</Text>
				)}
				{loaderData.list?.list ? (
					<Center>
						<ApplicationPagination
							size="sm"
							defaultValue={loaderData.page}
							onChange={(v) => setP("page", v.toString())}
							total={Math.ceil(
								loaderData.list.list.details.total /
									loaderData.coreDetails.pageLimit,
							)}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}
