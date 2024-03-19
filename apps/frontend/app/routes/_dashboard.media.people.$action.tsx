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
	Select,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
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
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	ApplicationPagination,
	DebouncedSearchInput,
} from "~/components/common";
import { BaseDisplayItem } from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

export type SearchParams = {
	query?: string;
};

const defaultFilters = {
	sortBy: PersonSortBy.MediaItems,
	orderBy: GraphqlSortOrder.Desc,
};

enum Action {
	Search = "search",
	List = "list",
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
	const coreDetails = await getCoreDetails();
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
				<Flex align="center" gap="md">
					<Title>People</Title>
				</Flex>
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
				{(loaderData.peopleList?.list.details.total || 0) > 0 ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.peopleList?.list.details.total}
							</Text>{" "}
							items found
						</Box>
						<ApplicationGrid>
							{loaderData.peopleList?.list.items.map((creator) => (
								<BaseDisplayItem
									name={creator.name}
									bottomLeft={`${creator.mediaCount} items`}
									imageLink={creator.image}
									imagePlaceholder={getInitials(creator.name)}
									key={creator.id}
									href={$path("/media/people/item/:id", { id: creator.id })}
								/>
							))}
						</ApplicationGrid>
					</>
				) : (
					<Text>No information to display</Text>
				)}
				{loaderData.peopleList ? (
					<Center>
						<ApplicationPagination
							size="sm"
							defaultValue={loaderData.page}
							onChange={(v) => setP("page", v.toString())}
							total={Math.ceil(
								loaderData.peopleList.list.details.total /
									loaderData.coreDetails.pageLimit,
							)}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}
