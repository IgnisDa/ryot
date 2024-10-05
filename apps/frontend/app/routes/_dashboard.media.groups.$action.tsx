import {
	ActionIcon,
	Box,
	Center,
	Checkbox,
	Container,
	Flex,
	Group,
	Loader,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineLoader } from "@remix-run/node";
import {
	type MetaArgs_SingleFetch,
	useLoaderData,
	useNavigate,
} from "@remix-run/react";
import {
	GraphqlSortOrder,
	MediaLot,
	MediaSource,
	MetadataGroupSearchDocument,
	type MetadataGroupSearchQuery,
	MetadataGroupsListDocument,
	PersonAndMetadataGroupsSortBy,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, isString, startCase } from "@ryot/ts-utils";
import {
	IconFilter,
	IconListCheck,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { useState } from "react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common";
import {
	BaseMediaDisplayItem,
	MetadataGroupDisplayItem,
} from "~/components/media";
import { commaDelimitedString, pageQueryParam } from "~/lib/generals";
import { useAppSearchParam } from "~/lib/hooks";
import {
	getEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	serverGqlService,
} from "~/lib/utilities.server";

export type SearchParams = {
	query?: string;
};

const defaultFilters = {
	sortBy: PersonAndMetadataGroupsSortBy.MediaItems,
	orderBy: GraphqlSortOrder.Desc,
};

enum Action {
	List = "list",
	Search = "search",
}

const SEARCH_SOURCES_ALLOWED: Partial<Record<MediaSource, MediaLot>> = {
	[MediaSource.Tmdb]: MediaLot.Movie,
	[MediaSource.Igdb]: MediaLot.VideoGame,
};

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { action } = zx.parseParams(params, { action: z.nativeEnum(Action) });
	const cookieName = await getEnhancedCookieName(`groups.${action}`, request);
	const query = zx.parseQuery(request, {
		query: z.string().optional(),
		[pageQueryParam]: zx.IntAsString.default("1"),
	});
	const [totalResults, list, search] = await match(action)
		.with(Action.List, async () => {
			const urlParse = zx.parseQuery(request, {
				sortBy: z
					.nativeEnum(PersonAndMetadataGroupsSortBy)
					.default(defaultFilters.sortBy),
				orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFilters.orderBy),
				collections: commaDelimitedString,
				invertCollection: zx.BoolAsString.optional(),
			});
			const { metadataGroupsList } =
				await serverGqlService.authenticatedRequest(
					request,
					MetadataGroupsListDocument,
					{
						input: {
							search: { page: query[pageQueryParam], query: query.query },
							sort: { by: urlParse.sortBy, order: urlParse.orderBy },
							filter: { collections: urlParse.collections },
							invertCollection: urlParse.invertCollection,
						},
					},
				);
			return [
				metadataGroupsList.details.total,
				{ list: metadataGroupsList, url: urlParse },
				undefined,
			] as const;
		})
		.with(Action.Search, async () => {
			const urlParse = zx.parseQuery(request, {
				source: z.nativeEnum(MediaSource).default(MediaSource.Tmdb),
			});
			const lot = SEARCH_SOURCES_ALLOWED[urlParse.source];
			invariant(lot);
			const { metadataGroupSearch } =
				await serverGqlService.authenticatedRequest(
					request,
					MetadataGroupSearchDocument,
					{
						input: {
							lot,
							source: urlParse.source,
							search: { page: query[pageQueryParam], query: query.query },
						},
					},
				);
			return [
				metadataGroupSearch.details.total,
				undefined,
				{ search: metadataGroupSearch, url: urlParse, lot },
			] as const;
		})
		.exhaustive();
	const totalPages = await redirectToFirstPageIfOnInvalidPage(
		request,
		totalResults,
		query[pageQueryParam],
	);
	return {
		list,
		query,
		action,
		search,
		totalPages,
		cookieName,
		[pageQueryParam]: query[pageQueryParam],
	};
});

export const meta = ({ params }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${changeCase(params.action || "")} Groups | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const navigate = useNavigate();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	return (
		<Container>
			<Stack>
				<Title>Groups</Title>
				<Tabs
					variant="default"
					value={loaderData.action}
					onChange={(v) => {
						if (v)
							navigate(
								$path(
									"/media/groups/:action",
									{ action: v },
									{
										...(loaderData.query.query && {
											query: loaderData.query.query,
										}),
									},
								),
							);
					}}
				>
					<Tabs.List style={{ alignItems: "center" }}>
						<Tabs.Tab value="list" leftSection={<IconListCheck size={24} />}>
							<Text>My Groups</Text>
						</Tabs.Tab>
						<Tabs.Tab value="search" leftSection={<IconSearch size={24} />}>
							<Text>Search</Text>
						</Tabs.Tab>
					</Tabs.List>
				</Tabs>

				<Group wrap="nowrap">
					<DebouncedSearchInput
						placeholder="Search for groups"
						initialValue={loaderData.query.query}
						enhancedQueryParams={loaderData.cookieName}
					/>
					{loaderData.action === Action.List ? (
						<>
							<ActionIcon
								onClick={openFiltersModal}
								color={
									loaderData.list?.url.orderBy !== defaultFilters.orderBy ||
									loaderData.list?.url.sortBy !== defaultFilters.sortBy ||
									isString(loaderData.list?.url.collections)
										? "blue"
										: "gray"
								}
							>
								<IconFilter size={24} />
							</ActionIcon>
							<FiltersModal
								closeFiltersModal={closeFiltersModal}
								cookieName={loaderData.cookieName}
								opened={filtersModalOpened}
							>
								<FiltersModalForm />
							</FiltersModal>
						</>
					) : null}
					{loaderData.action === Action.Search ? (
						<>
							<Select
								data={Object.keys(SEARCH_SOURCES_ALLOWED).map((o) => ({
									value: o.toString(),
									label: startCase(o.toLowerCase()),
								}))}
								defaultValue={loaderData.search?.url.source}
								onChange={(v) => setP("source", v)}
							/>
						</>
					) : null}
				</Group>

				{loaderData.list ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.list.list.details.total}
							</Text>{" "}
							items found
						</Box>
						{loaderData.list.list.details.total > 0 ? (
							<ApplicationGrid>
								{loaderData.list.list.items.map((gr) => (
									<MetadataGroupDisplayItem key={gr} metadataGroupId={gr} />
								))}
							</ApplicationGrid>
						) : (
							<Text>No information to display</Text>
						)}
						<Center>
							<Pagination
								size="sm"
								total={loaderData.totalPages}
								value={loaderData[pageQueryParam]}
								onChange={(v) => setP(pageQueryParam, v.toString())}
							/>
						</Center>
					</>
				) : null}

				{loaderData.search ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.search.search.details.total}
							</Text>{" "}
							items found
						</Box>
						{loaderData.search.search.details.total > 0 ? (
							<ApplicationGrid>
								{loaderData.search.search.items.map((group) => (
									<GroupSearchItem item={group} key={group.identifier} />
								))}
							</ApplicationGrid>
						) : (
							<Text>No groups found matching your query</Text>
						)}
						<Center>
							<Pagination
								size="sm"
								total={loaderData.totalPages}
								value={loaderData[pageQueryParam]}
								onChange={(v) => setP(pageQueryParam, v.toString())}
							/>
						</Center>
					</>
				) : null}
			</Stack>
		</Container>
	);
}

const GroupSearchItem = (props: {
	item: MetadataGroupSearchQuery["metadataGroupSearch"]["items"][number];
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);

	return (
		<BaseMediaDisplayItem
			isLoading={false}
			name={props.item.name}
			imageUrl={props.item.image}
			imageOverlay={{
				topLeft: isLoading ? (
					<Loader color="red" variant="bars" size="sm" m={2} />
				) : null,
			}}
			labels={{
				left: props.item.parts ? `${props.item.parts} items` : undefined,
			}}
			onImageClickBehavior={async () => {
				if (loaderData.search) {
					setIsLoading(true);
					const id = await commitGroup(
						props.item.identifier,
						loaderData.search.url.source,
						loaderData.search.lot,
					);
					setIsLoading(false);
					return navigate($path("/media/groups/item/:id", { id }));
				}
			}}
		/>
	);
};

const commitGroup = async (
	identifier: string,
	source: MediaSource,
	lot: MediaLot,
) => {
	const data = new FormData();
	data.append("identifier", identifier);
	data.append("source", source);
	data.append("lot", lot);
	const resp = await fetch(
		$path("/actions", { intent: "commitMetadataGroup" }),
		{ method: "POST", body: data },
	);
	const json = await resp.json();
	return json.commitMetadataGroup.id;
};

const FiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	if (!loaderData.list) return null;

	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					data={Object.values(PersonAndMetadataGroupsSortBy).map((o) => ({
						value: o.toString(),
						label: startCase(o.toLowerCase()),
					}))}
					defaultValue={loaderData.list.url.sortBy}
					onChange={(v) => setP("sortBy", v)}
				/>
				<ActionIcon
					onClick={() => {
						if (loaderData.list?.url.orderBy === GraphqlSortOrder.Asc)
							setP("orderBy", GraphqlSortOrder.Desc);
						else setP("orderBy", GraphqlSortOrder.Asc);
					}}
				>
					{loaderData.list.url.orderBy === GraphqlSortOrder.Asc ? (
						<IconSortAscending />
					) : (
						<IconSortDescending />
					)}
				</ActionIcon>
			</Flex>
			<Flex gap="xs" align="center">
				<CollectionsFilter
					cookieName={loaderData.cookieName}
					collections={loaderData.list.url.collections}
				/>
				<Checkbox
					label="Invert"
					checked={loaderData.list.url.invertCollection}
					onChange={(e) => setP("invertCollection", String(e.target.checked))}
				/>
			</Flex>
		</>
	);
};
