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
	MediaSource,
	PeopleListDocument,
	PeopleSearchDocument,
	type PeopleSearchQuery,
	PersonSortBy,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
import {
	IconFilter,
	IconListCheck,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { useState } from "react";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common";
import { BaseMediaDisplayItem, PersonDisplayItem } from "~/components/media";
import { commaDelimitedString, pageQueryParam } from "~/lib/generals";
import { useAppSearchParam, useCoreDetails } from "~/lib/hooks";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

export type SearchParams = {
	query?: string;
};

const defaultFilters = {
	sortBy: PersonSortBy.MediaItems,
	orderBy: GraphqlSortOrder.Desc,
};

enum Action {
	List = "list",
	Search = "search",
}

const SEARCH_SOURCES_ALLOWED = [
	MediaSource.Tmdb,
	MediaSource.Anilist,
	MediaSource.Vndb,
	MediaSource.Openlibrary,
	MediaSource.Audible,
	MediaSource.MangaUpdates,
	MediaSource.Igdb,
] as const;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { action } = zx.parseParams(params, { action: z.nativeEnum(Action) });
	const cookieName = await getEnhancedCookieName(`people.${action}`, request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const { query, page } = zx.parseQuery(request, {
		query: z.string().optional(),
		page: zx.IntAsString.default("1"),
	});
	const [peopleList, peopleSearch] = await match(action)
		.with(Action.List, async () => {
			const urlParse = zx.parseQuery(request, {
				sortBy: z.nativeEnum(PersonSortBy).default(defaultFilters.sortBy),
				orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFilters.orderBy),
				collections: commaDelimitedString,
				invertCollection: zx.BoolAsString.optional(),
			});
			const { peopleList } = await serverGqlService.authenticatedRequest(
				request,
				PeopleListDocument,
				{
					input: {
						search: { page, query },
						sort: { by: urlParse.sortBy, order: urlParse.orderBy },
						filter: { collections: urlParse.collections },
						invertCollection: urlParse.invertCollection,
					},
				},
			);
			return [{ list: peopleList, url: urlParse }, undefined] as const;
		})
		.with(Action.Search, async () => {
			const urlParse = zx.parseQuery(request, {
				source: z.nativeEnum(MediaSource).default(MediaSource.Tmdb),
				isTmdbCompany: zx.BoolAsString.optional(),
				isAnilistStudio: zx.BoolAsString.optional(),
			});
			const { peopleSearch } = await serverGqlService.authenticatedRequest(
				request,
				PeopleSearchDocument,
				{
					input: {
						source: urlParse.source,
						search: { page, query },
						sourceSpecifics: {
							isAnilistStudio: urlParse.isAnilistStudio,
							isTmdbCompany: urlParse.isTmdbCompany,
						},
					},
				},
			);
			return [undefined, { search: peopleSearch, url: urlParse }] as const;
		})
		.exhaustive();
	return { action, query, page, peopleList, peopleSearch, cookieName };
});

export const meta = ({ params }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${changeCase(params.action || "")} People | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const navigate = useNavigate();
	const [_e, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	return (
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
									{ query: loaderData.query },
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
						initialValue={loaderData.query}
						enhancedQueryParams={loaderData.cookieName}
					/>
					{loaderData.action === Action.List ? (
						<>
							<ActionIcon
								onClick={openFiltersModal}
								color={
									loaderData.peopleList?.url.orderBy !==
										defaultFilters.orderBy ||
									loaderData.peopleList?.url.sortBy !== defaultFilters.sortBy
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
								data={SEARCH_SOURCES_ALLOWED.map((o) => ({
									value: o.toString(),
									label: startCase(o.toLowerCase()),
								}))}
								defaultValue={loaderData.peopleSearch?.url.source}
								onChange={(v) => setP("source", v)}
							/>
							{loaderData.peopleSearch?.url.source === MediaSource.Tmdb ? (
								<Checkbox
									checked={loaderData.peopleSearch?.url.isTmdbCompany}
									onChange={(e) =>
										setP("isTmdbCompany", String(e.target.checked))
									}
									label="Company"
								/>
							) : null}
							{loaderData.peopleSearch?.url.source === MediaSource.Anilist ? (
								<Checkbox
									checked={loaderData.peopleSearch?.url.isAnilistStudio}
									onChange={(e) =>
										setP("isAnilistStudio", String(e.target.checked))
									}
									label="Studio"
								/>
							) : null}
						</>
					) : null}
				</Group>
				{loaderData.peopleList ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.peopleList.list.details.total}
							</Text>{" "}
							items found
						</Box>
						{loaderData.peopleList.list.details.total > 0 ? (
							<ApplicationGrid>
								{loaderData.peopleList?.list.items.map((person) => (
									<PersonDisplayItem key={person} personId={person} />
								))}
							</ApplicationGrid>
						) : (
							<Text>No information to display</Text>
						)}
						<Center>
							<Pagination
								size="sm"
								value={loaderData.page}
								onChange={(v) => setP(pageQueryParam, v.toString())}
								total={Math.ceil(
									loaderData.peopleList.list.details.total /
										coreDetails.pageLimit,
								)}
							/>
						</Center>
					</>
				) : null}
				{loaderData.peopleSearch ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.peopleSearch.search.details.total}
							</Text>{" "}
							items found
						</Box>
						{loaderData.peopleSearch.search.details.total > 0 ? (
							<ApplicationGrid>
								{loaderData.peopleSearch.search.items.map((person) => (
									<PersonSearchItem item={person} key={person.identifier} />
								))}
							</ApplicationGrid>
						) : (
							<Text>No people found matching your query</Text>
						)}
						<Center>
							<Pagination
								size="sm"
								value={loaderData.page}
								onChange={(v) => setP(pageQueryParam, v.toString())}
								total={Math.ceil(
									loaderData.peopleSearch.search.details.total /
										coreDetails.pageLimit,
								)}
							/>
						</Center>
					</>
				) : null}
			</Stack>
		</Container>
	);
}

const PersonSearchItem = (props: {
	item: PeopleSearchQuery["peopleSearch"]["items"][number];
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
			onImageClickBehavior={async () => {
				if (loaderData.peopleSearch) {
					setIsLoading(true);
					const id = await commitPerson(
						props.item.identifier,
						loaderData.peopleSearch.url.source,
						props.item.name,
						loaderData.peopleSearch.url.isTmdbCompany,
						loaderData.peopleSearch.url.isAnilistStudio,
					);
					setIsLoading(false);
					return navigate($path("/media/people/item/:id", { id }));
				}
			}}
		/>
	);
};

const commitPerson = async (
	identifier: string,
	source: MediaSource,
	name: string,
	isTmdbCompany?: boolean,
	isAnilistStudio?: boolean,
) => {
	const data = new FormData();
	data.append("identifier", identifier);
	data.append("source", source);
	if (name) data.append("name", name);
	if (isTmdbCompany) data.append("isTmdbCompany", String(isTmdbCompany));
	if (isAnilistStudio) data.append("isAnilistStudio", String(isAnilistStudio));
	const resp = await fetch($path("/actions", { intent: "commitPerson" }), {
		method: "POST",
		body: data,
	});
	const json = await resp.json();
	return json.commitPerson.id;
};

const FiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	if (!loaderData.peopleList) return null;

	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					data={Object.values(PersonSortBy).map((o) => ({
						value: o.toString(),
						label: startCase(o.toLowerCase()),
					}))}
					defaultValue={loaderData.peopleList.url.sortBy}
					onChange={(v) => setP("sortBy", v)}
				/>
				<ActionIcon
					onClick={() => {
						if (loaderData.peopleList?.url.orderBy === GraphqlSortOrder.Asc)
							setP("orderBy", GraphqlSortOrder.Desc);
						else setP("orderBy", GraphqlSortOrder.Asc);
					}}
				>
					{loaderData.peopleList.url.orderBy === GraphqlSortOrder.Asc ? (
						<IconSortAscending />
					) : (
						<IconSortDescending />
					)}
				</ActionIcon>
			</Flex>
			<Flex gap="xs" align="center">
				<CollectionsFilter
					cookieName={loaderData.cookieName}
					collections={loaderData.peopleList.url.collections}
				/>
				<Checkbox
					label="Invert"
					checked={loaderData.peopleList.url.invertCollection}
					onChange={(e) => setP("invertCollection", String(e.target.checked))}
				/>
			</Flex>
		</>
	);
};
