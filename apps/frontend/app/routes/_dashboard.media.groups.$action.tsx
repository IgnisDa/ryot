import {
	ActionIcon,
	Box,
	Center,
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
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
	EntityLot,
	GraphqlSortOrder,
	type MediaLot,
	MediaSource,
	MetadataGroupSearchDocument,
	type MetadataGroupSearchQuery,
	PersonAndMetadataGroupsSortBy,
	UserMetadataGroupsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	isString,
	parseParameters,
	parseSearchQuery,
	startCase,
	zodBoolAsString,
	zodIntAsString,
} from "@ryot/ts-utils";
import {
	IconCheck,
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
import {
	ApplicationGrid,
	CollectionsFilter,
	DebouncedSearchInput,
	DisplayListDetailsAndRefresh,
	FiltersModal,
} from "~/components/common";
import { BaseMediaDisplayItem } from "~/components/common";
import { MetadataGroupDisplayItem } from "~/components/media";
import { pageQueryParam, zodCommaDelimitedString } from "~/lib/generals";
import { useAppSearchParam, useCoreDetails } from "~/lib/hooks";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	getCoreDetails,
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const { action } = parseParameters(
		params,
		z.object({ action: z.nativeEnum(Action) }),
	);
	const cookieName = await getEnhancedCookieName(`groups.${action}`, request);
	const schema = z.object({
		query: z.string().optional(),
		[pageQueryParam]: zodIntAsString.default("1"),
	});
	const query = parseSearchQuery(request, schema);
	const [totalResults, list, search] = await match(action)
		.with(Action.List, async () => {
			const listSchema = z.object({
				collections: zodCommaDelimitedString,
				invertCollection: zodBoolAsString.optional(),
				orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFilters.orderBy),
				sortBy: z
					.nativeEnum(PersonAndMetadataGroupsSortBy)
					.default(defaultFilters.sortBy),
			});
			const urlParse = parseSearchQuery(request, listSchema);
			const { userMetadataGroupsList } =
				await serverGqlService.authenticatedRequest(
					request,
					UserMetadataGroupsListDocument,
					{
						input: {
							invertCollection: urlParse.invertCollection,
							filter: { collections: urlParse.collections },
							sort: { by: urlParse.sortBy, order: urlParse.orderBy },
							search: { page: query[pageQueryParam], query: query.query },
						},
					},
				);
			return [
				userMetadataGroupsList.response.details.total,
				{ list: userMetadataGroupsList, url: urlParse },
				undefined,
			] as const;
		})
		.with(Action.Search, async () => {
			const searchSchema = z.object({
				source: z.nativeEnum(MediaSource).default(MediaSource.Tmdb),
			});
			const urlParse = parseSearchQuery(request, searchSchema);
			const coreDetails = await getCoreDetails();
			const lot = coreDetails.metadataGroupSourceLotMappings.find(
				(m) => m.source === urlParse.source,
			)?.lot;
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
};

export const meta = ({ params }: MetaArgs<typeof loader>) => {
	return [{ title: `${changeCase(params.action || "")} Groups | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const navigate = useNavigate();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const bulkEditingCollection = useBulkEditCollection();
	const bulkEditingState = bulkEditingCollection.state;

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
								onChange={(v) => setP("source", v)}
								defaultValue={loaderData.search?.url.source}
								data={coreDetails.metadataGroupSourceLotMappings.map((o) => ({
									value: o.source.toString(),
									label: startCase(o.source.toLowerCase()),
								}))}
							/>
						</>
					) : null}
				</Group>
				{loaderData.list ? (
					<>
						<DisplayListDetailsAndRefresh
							cacheId={loaderData.list.list.cacheId}
							total={loaderData.list.list.response.details.total}
						/>
						{loaderData.list.list.response.details.total > 0 ? (
							<ApplicationGrid>
								{loaderData.list.list.response.items.map((gr) => {
									const becItem = {
										entityId: gr,
										entityLot: EntityLot.MetadataGroup,
									};
									const isAdded = bulkEditingCollection.isAdded(becItem);
									return (
										<MetadataGroupDisplayItem
											key={gr}
											metadataGroupId={gr}
											topRight={
												bulkEditingState &&
												bulkEditingState.data.action === "add" ? (
													<ActionIcon
														variant={isAdded ? "filled" : "transparent"}
														color="green"
														onClick={() => {
															if (isAdded) bulkEditingState.remove(becItem);
															else bulkEditingState.add(becItem);
														}}
													>
														<IconCheck size={18} />
													</ActionIcon>
												) : undefined
											}
										/>
									);
								})}
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
						props.item.name,
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
	name: string,
	identifier: string,
	source: MediaSource,
	lot: MediaLot,
) => {
	const data = new FormData();
	data.append("name", name);
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
			<CollectionsFilter
				cookieName={loaderData.cookieName}
				collections={loaderData.list.url.collections}
				invertCollection={loaderData.list.url.invertCollection}
			/>
		</>
	);
};
