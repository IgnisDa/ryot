import {
	ActionIcon,
	Box,
	Center,
	Checkbox,
	Container,
	Divider,
	Flex,
	Group,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	EntityLot,
	GraphqlSortOrder,
	MediaSource,
	PeopleSearchDocument,
	PersonAndMetadataGroupsSortBy,
	UserPeopleListDocument,
	type UserPeopleListInput,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	cloneDeep,
	isEqual,
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
import { useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { z } from "zod";
import {
	ApplicationGrid,
	BulkCollectionEditingAffix,
	CollectionsFilter,
	DebouncedSearchInput,
	DisplayListDetailsAndRefresh,
	FiltersModal,
} from "~/components/common";
import { PersonDisplayItem } from "~/components/media/display-items";
import { pageQueryParam } from "~/lib/shared/constants";
import { useAppSearchParam, useCoreDetails } from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/query-factory";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { zodCollectionFilter } from "~/lib/shared/validation";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	getSearchEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.media.people.$action";

export type SearchParams = {
	query?: string;
};

const defaultFilters = {
	collections: [],
	orderBy: GraphqlSortOrder.Desc,
	sortBy: PersonAndMetadataGroupsSortBy.AssociatedEntityCount,
};

enum Action {
	List = "list",
	Search = "search",
}

const searchSchema = z.object({
	isTmdbCompany: zodBoolAsString.optional(),
	isAnilistStudio: zodBoolAsString.optional(),
	isHardcoverPublisher: zodBoolAsString.optional(),
	isGiantBombCompany: zodBoolAsString.optional(),
	source: z.nativeEnum(MediaSource).default(MediaSource.Tmdb),
});

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { action } = parseParameters(
		params,
		z.object({ action: z.nativeEnum(Action) }),
	);
	const cookieName = await getSearchEnhancedCookieName(
		`people.${action}`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const schema = z.object({
		query: z.string().optional(),
		[pageQueryParam]: zodIntAsString.default("1"),
	});
	const query = parseSearchQuery(request, schema);
	const [totalResults, list, search, respectCoreDetailsPageSize, listInput] =
		await match(action)
			.with(Action.List, async () => {
				const listSchema = z.object({
					collections: zodCollectionFilter,
					orderBy: z
						.nativeEnum(GraphqlSortOrder)
						.default(defaultFilters.orderBy),
					sortBy: z
						.nativeEnum(PersonAndMetadataGroupsSortBy)
						.default(defaultFilters.sortBy),
				});
				const urlParse = parseSearchQuery(request, listSchema);
				const input: UserPeopleListInput = {
					filter: { collections: urlParse.collections },
					sort: { by: urlParse.sortBy, order: urlParse.orderBy },
					search: { page: query[pageQueryParam], query: query.query },
				};
				const { userPeopleList } = await serverGqlService.authenticatedRequest(
					request,
					UserPeopleListDocument,
					{ input },
				);
				return [
					userPeopleList.response.details.total,
					{ list: userPeopleList, url: urlParse },
					undefined,
					false,
					input,
				] as const;
			})
			.with(Action.Search, async () => {
				const urlParse = parseSearchQuery(request, searchSchema);
				const { peopleSearch } = await serverGqlService.authenticatedRequest(
					request,
					PeopleSearchDocument,
					{
						input: {
							source: urlParse.source,
							sourceSpecifics: {
								isTmdbCompany: urlParse.isTmdbCompany,
								isAnilistStudio: urlParse.isAnilistStudio,
								isHardcoverPublisher: urlParse.isHardcoverPublisher,
								isGiantBombCompany: urlParse.isGiantBombCompany,
							},
							search: { page: query[pageQueryParam], query: query.query },
						},
					},
				);
				return [
					peopleSearch.details.total,
					undefined,
					{ search: peopleSearch, url: urlParse },
					true,
					undefined,
				] as const;
			})
			.exhaustive();
	const totalPages = await redirectToFirstPageIfOnInvalidPage({
		request,
		totalResults,
		respectCoreDetailsPageSize,
		currentPage: query[pageQueryParam],
	});
	return {
		list,
		query,
		action,
		search,
		listInput,
		totalPages,
		cookieName,
		[pageQueryParam]: query[pageQueryParam],
	};
};

export const meta = ({ params }: Route.MetaArgs) => {
	return [{ title: `${changeCase(params.action || "")} People | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const coreDetails = useCoreDetails();
	const [_e, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const bulkEditingCollection = useBulkEditCollection();

	const bulkEditingState = bulkEditingCollection.state;
	const areFiltersApplied =
		loaderData.list?.url.orderBy !== defaultFilters.orderBy ||
		loaderData.list?.url.sortBy !== defaultFilters.sortBy ||
		!isEqual(loaderData.list?.url.collections, defaultFilters.collections);

	return (
		<>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					if (!loaderData.listInput) return [];
					const input = cloneDeep(loaderData.listInput);
					input.search = { ...input.search, take: Number.MAX_SAFE_INTEGER };
					return await clientGqlService
						.request(UserPeopleListDocument, { input })
						.then((r) =>
							r.userPeopleList.response.items.map((p) => ({
								entityId: p,
								entityLot: EntityLot.Person,
							})),
						);
				}}
			/>
			<Container>
				<Stack>
					<Title>People</Title>
					<Tabs
						variant="default"
						value={loaderData.action}
						onChange={(v) => {
							if (v)
								navigate(
									$path(
										"/media/people/:action",
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
								<Text>My People</Text>
							</Tabs.Tab>
							<Tabs.Tab value="search" leftSection={<IconSearch size={24} />}>
								<Text>Search</Text>
							</Tabs.Tab>
						</Tabs.List>
					</Tabs>

					<Group wrap="nowrap">
						<DebouncedSearchInput
							placeholder="Search for people"
							initialValue={loaderData.query.query}
							enhancedQueryParams={loaderData.cookieName}
						/>
						{loaderData.action === Action.List ? (
							<>
								<ActionIcon
									onClick={openFiltersModal}
									color={areFiltersApplied ? "blue" : "gray"}
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
									data={coreDetails.peopleSearchSources.map((o) => ({
										value: o.toString(),
										label: startCase(o.toLowerCase()),
									}))}
								/>
								{loaderData.search?.url.source === MediaSource.Tmdb ? (
									<Checkbox
										label="Company"
										checked={loaderData.search?.url.isTmdbCompany}
										onChange={(e) =>
											setP("isTmdbCompany", String(e.target.checked))
										}
									/>
								) : null}
								{loaderData.search?.url.source === MediaSource.Anilist ? (
									<Checkbox
										label="Studio"
										checked={loaderData.search?.url.isAnilistStudio}
										onChange={(e) =>
											setP("isAnilistStudio", String(e.target.checked))
										}
									/>
								) : null}
								{loaderData.search?.url.source === MediaSource.Hardcover ? (
									<Checkbox
										label="Publisher"
										checked={loaderData.search?.url.isHardcoverPublisher}
										onChange={(e) =>
											setP("isHardcoverPublisher", String(e.target.checked))
										}
									/>
								) : null}
								{loaderData.search?.url.source === MediaSource.GiantBomb ? (
									<Checkbox
										label="Company"
										checked={loaderData.search?.url.isGiantBombCompany}
										onChange={(e) =>
											setP("isGiantBombCompany", String(e.target.checked))
										}
									/>
								) : null}
							</>
						) : null}
					</Group>
					{loaderData.list ? (
						<>
							<DisplayListDetailsAndRefresh
								cacheId={loaderData.list.list.cacheId}
								total={loaderData.list.list.response.details.total}
								isRandomSortOrderSelected={
									loaderData.list.url.sortBy ===
									PersonAndMetadataGroupsSortBy.Random
								}
							/>
							{loaderData.list.list.response.details.total > 0 ? (
								<ApplicationGrid>
									{loaderData.list.list.response.items.map((person) => {
										const becItem = {
											entityId: person,
											entityLot: EntityLot.Person,
										};
										const isAdded = bulkEditingCollection.isAdded(becItem);
										return (
											<PersonDisplayItem
												key={person}
												personId={person}
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
									{loaderData.search.search.items.map((person) => (
										<PersonDisplayItem
											key={person}
											personId={person}
											shouldHighlightNameIfInteracted
										/>
									))}
								</ApplicationGrid>
							) : (
								<Text>No people found matching your query</Text>
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
		</>
	);
}

const FiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	if (!loaderData.list) return null;

	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					onChange={(v) => setP("sortBy", v)}
					defaultValue={loaderData.list.url.sortBy}
					data={convertEnumToSelectData(PersonAndMetadataGroupsSortBy)}
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
			<Divider />
			<CollectionsFilter
				cookieName={loaderData.cookieName}
				applied={loaderData.list.url.collections}
			/>
		</>
	);
};
