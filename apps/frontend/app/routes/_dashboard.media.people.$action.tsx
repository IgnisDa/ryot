import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Box,
	Center,
	Checkbox,
	Container,
	Flex,
	Group,
	Modal,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
	GraphqlSortOrder,
	MediaSource,
	PeopleListDocument,
	PeopleSearchDocument,
	PersonSortBy,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, startCase } from "@ryot/ts-utils";
import {
	IconFilter,
	IconFilterOff,
	IconListCheck,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { useState } from "react";
import { match } from "ts-pattern";
import { withQuery, withoutHost } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, DebouncedSearchInput } from "~/components/common";
import {
	BaseDisplayItem,
	type Item,
	MediaItemWithoutUpdateModal,
} from "~/components/media";
import { redirectToQueryParam } from "~/lib/generals";
import { useSearchParam } from "~/lib/hooks";
import {
	getAuthorizationHeader,
	getCoreDetails,
	getUserPreferences,
	gqlClient,
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const action = params.action as Action;
	const [coreDetails, userPreferences] = await Promise.all([
		getCoreDetails(request),
		getUserPreferences(request),
	]);
	const { query, page } = zx.parseQuery(request, {
		query: z.string().optional(),
		page: zx.IntAsString.default("1"),
	});
	const [peopleList, peopleSearch] = await match(action)
		.with(Action.List, async () => {
			const urlParse = zx.parseQuery(
				request,
				z.object({
					sortBy: z.nativeEnum(PersonSortBy).default(defaultFilters.sortBy),
					orderBy: z
						.nativeEnum(GraphqlSortOrder)
						.default(defaultFilters.orderBy),
				}),
			);
			const { peopleList } = await gqlClient.request(
				PeopleListDocument,
				{
					input: {
						search: { page, query },
						sort: { by: urlParse.sortBy, order: urlParse.orderBy },
					},
				},
				await getAuthorizationHeader(request),
			);
			return [{ list: peopleList, url: urlParse }, undefined] as const;
		})
		.with(Action.Search, async () => {
			const urlParse = zx.parseQuery(
				request,
				z.object({
					source: z.nativeEnum(MediaSource).default(MediaSource.Tmdb),
					isTmdbCompany: zx.BoolAsString.optional(),
					isAnilistStudio: zx.BoolAsString.optional(),
				}),
			);
			const { peopleSearch } = await gqlClient.request(
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
				await getAuthorizationHeader(request),
			);
			return [undefined, { search: peopleSearch, url: urlParse }] as const;
		})
		.exhaustive();
	return json({
		action,
		query,
		page,
		coreDetails: { pageLimit: coreDetails.pageLimit },
		userPreferences: { reviewScale: userPreferences.general.reviewScale },
		peopleList,
		peopleSearch,
	});
};

export const meta: MetaFunction = ({ params }) => {
	return [
		{
			title: `${changeCase(params.action || "")} People | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [_, { setP }] = useSearchParam();
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
							<Modal
								opened={filtersModalOpened}
								onClose={closeFiltersModal}
								centered
								withCloseButton={false}
							>
								<Stack>
									<Group>
										<Title order={3}>Sort by</Title>
										<ActionIcon
											onClick={() => {
												navigate(".");
												closeFiltersModal();
											}}
										>
											<IconFilterOff size={24} />
										</ActionIcon>
									</Group>
									<Flex gap="xs" align="center">
										<Select
											w="100%"
											data={Object.values(PersonSortBy).map((o) => ({
												value: o.toString(),
												label: startCase(o.toLowerCase()),
											}))}
											defaultValue={loaderData.peopleList?.url.sortBy}
											onChange={(v) => setP("sortBy", v)}
										/>
										<ActionIcon
											onClick={() => {
												if (
													loaderData.peopleList?.url.orderBy ===
													GraphqlSortOrder.Asc
												)
													setP("orderBy", GraphqlSortOrder.Desc);
												else setP("orderBy", GraphqlSortOrder.Asc);
											}}
										>
											{loaderData.peopleList?.url.orderBy ===
											GraphqlSortOrder.Asc ? (
												<IconSortAscending />
											) : (
												<IconSortDescending />
											)}
										</ActionIcon>
									</Flex>
								</Stack>
							</Modal>
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
							<>
								<ApplicationGrid>
									{loaderData.peopleList?.list.items.map((person) => (
										<BaseDisplayItem
											name={person.name}
											bottomLeft={`${person.mediaCount} items`}
											imageLink={person.image}
											imagePlaceholder={getInitials(person.name)}
											key={person.id}
											href={$path("/media/people/item/:id", { id: person.id })}
										/>
									))}
								</ApplicationGrid>
								<Center>
									<Pagination
										size="sm"
										value={loaderData.page}
										onChange={(v) => setP("page", v.toString())}
										total={Math.ceil(
											loaderData.peopleList.list.details.total /
												loaderData.coreDetails.pageLimit,
										)}
									/>
								</Center>
							</>
						) : (
							<Text>No information to display</Text>
						)}
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
							<>
								<ApplicationGrid>
									{loaderData.peopleSearch.search.items.map((person) => (
										<PersonSearchItem
											item={{
												...person,
												title: person.name,
												publishYear: person.birthYear?.toString(),
											}}
											key={person.identifier}
										/>
									))}
								</ApplicationGrid>
								<Center>
									<Pagination
										size="sm"
										value={loaderData.page}
										onChange={(v) => setP("page", v.toString())}
										total={Math.ceil(
											loaderData.peopleSearch.search.details.total /
												loaderData.coreDetails.pageLimit,
										)}
									/>
								</Center>
							</>
						) : (
							<Text>No people found matching your query</Text>
						)}
					</>
				) : null}
			</Stack>
		</Container>
	);
}

const PersonSearchItem = (props: {
	item: Item;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			noRatingLink
			noHref
			reviewScale={loaderData.userPreferences.reviewScale}
			imageOverlayForLoadingIndicator={isLoading}
			onClick={async (_) => {
				if (loaderData.peopleSearch) {
					setIsLoading(true);
					const id = await commitPerson(
						props.item.identifier,
						loaderData.peopleSearch.url.source,
						props.item.title,
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
	const location = withoutHost(window.location.href);
	data.append("identifier", identifier);
	data.append("source", source);
	if (name) data.append("name", name);
	if (isTmdbCompany) data.append("isTmdbCompany", String(isTmdbCompany));
	if (isAnilistStudio) data.append("isAnilistStudio", String(isAnilistStudio));
	data.append(redirectToQueryParam, location);
	const resp = await fetch(withQuery("/actions", { intent: "commitPerson" }), {
		method: "POST",
		body: data,
	});
	const json = await resp.json();
	return json.commitPerson.id;
};
