import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Box,
	Button,
	Center,
	Container,
	Flex,
	Group,
	Modal,
	Select,
	Stack,
	Tabs,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDidUpdate, useDisclosure } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
	GraphqlSortOrder,
	MediaGeneralFilter,
	MediaListDocument,
	MediaSearchDocument,
	MediaSortBy,
	MediaSourcesForLotDocument,
	MetadataSource,
	UserCollectionsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
import {
	IconFilter,
	IconFilterOff,
	IconListCheck,
	IconPhotoPlus,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
	IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, ApplicationPagination } from "~/components/common";
import {
	MediaItemWithoutUpdateModal,
	MediaSearchItem,
} from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getLot } from "~/lib/generals";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

export type SearchParams = {
	query?: string;
};

const defaultFilters = {
	mineCollectionFilter: undefined,
	mineGeneralFilter: MediaGeneralFilter.All,
	mineSortOrder: GraphqlSortOrder.Desc,
	mineSortBy: MediaSortBy.LastSeen,
};

enum Action {
	Search = "search",
	List = "list",
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const [coreDetails, userPreferences] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
	]);
	const { query, page } = zx.parseQuery(request, {
		query: z.string().optional(),
		page: zx.IntAsString.default("1"),
	});
	const numPage = Number(page);
	const lot = getLot(params.lot);
	invariant(lot, "Lot is not defined");
	const action = params.action as Action;
	invariant(
		action && Object.values(Action).includes(action as Action),
		"Incorrect action",
	);
	const [mediaList, mediaSearch] = await match(action)
		.with(Action.List, async () => {
			const urlParse = zx.parseQuery(request, {
				sortOrder: z
					.nativeEnum(GraphqlSortOrder)
					.default(defaultFilters.mineSortOrder),
				sortBy: z.nativeEnum(MediaSortBy).default(defaultFilters.mineSortBy),
				generalFilter: z
					.nativeEnum(MediaGeneralFilter)
					.default(defaultFilters.mineGeneralFilter),
				collectionFilter: zx.IntAsString.optional(),
			});
			const { mediaList } = await gqlClient.request(
				MediaListDocument,
				{
					input: {
						lot,
						search: { page: numPage, query },
						sort: { order: urlParse.sortOrder, by: urlParse.sortBy },
						filter: {
							general: urlParse.generalFilter,
							collection: urlParse.collectionFilter,
						},
					},
				},
				await getAuthorizationHeader(request),
			);
			const { userCollectionsList } = await gqlClient.request(
				UserCollectionsListDocument,
				{},
				await getAuthorizationHeader(request),
			);
			return [
				{ list: mediaList, collections: userCollectionsList, url: urlParse },
				undefined,
			] as const;
		})
		.with(Action.Search, async () => {
			const { mediaSourcesForLot } = await gqlClient.request(
				MediaSourcesForLotDocument,
				{ lot },
			);
			const urlParse = zx.parseQuery(request, {
				source: z.nativeEnum(MetadataSource).default(mediaSourcesForLot[0]),
			});
			const { mediaSearch } = await gqlClient.request(
				MediaSearchDocument,
				{
					lot,
					input: { page, query: query || "" },
					source: urlParse.source,
				},
				await getAuthorizationHeader(request),
			);
			return [
				undefined,
				{
					search: mediaSearch,
					url: urlParse,
					mediaSources: mediaSourcesForLot,
				},
			] as const;
		})
		.exhaustive();
	return json({
		userPreferences: { reviewScale: userPreferences.general.reviewScale },
		lot,
		coreDetails: { pageLimit: coreDetails.pageLimit },
		action,
		mediaList,
		mediaSearch,
		query,
		numPage,
	});
};

export const meta: MetaFunction = ({ params }) => {
	return [
		{
			title: `${params.action === "list" ? "List" : "Search"} ${changeCase(
				params.lot?.toLowerCase() || "",
			)}s | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useSearchParam();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const navigate = useNavigate();
	const [query, setQuery] = useState(loaderData.query || "");

	useDidUpdate(() => setP("query", query), [query]);

	const isFilterChanged =
		loaderData.mediaList?.url.generalFilter !==
			defaultFilters.mineGeneralFilter ||
		loaderData.mediaList?.url.sortOrder !== defaultFilters.mineSortOrder ||
		loaderData.mediaList?.url.sortBy !== defaultFilters.mineSortBy ||
		loaderData.mediaList?.url.collectionFilter !==
			defaultFilters.mineCollectionFilter;

	const ClearButton = () => (
		<ActionIcon onClick={() => setQuery("")} disabled={query === ""}>
			<IconX size={16} />
		</ActionIcon>
	);

	const SearchInput = (props: { placeholder: string }) => {
		return (
			<TextInput
				name="query"
				placeholder={props.placeholder}
				leftSection={<IconSearch />}
				onChange={(e) => setQuery(e.currentTarget.value)}
				value={query}
				rightSection={<ClearButton />}
				style={{ flexGrow: 1 }}
				autoCapitalize="none"
				autoComplete="off"
			/>
		);
	};

	return (
		<Container>
			<Tabs
				variant="default"
				value={loaderData.action}
				onChange={(v) => {
					if (v)
						navigate(
							$path(
								"/media/:action/:lot",
								{ action: v, lot: loaderData.lot.toLowerCase() },
								{ query: loaderData.query },
							),
						);
				}}
			>
				<Tabs.List mb="xs" style={{ alignItems: "center" }}>
					<Tabs.Tab value="list" leftSection={<IconListCheck size={24} />}>
						<Text>My {changeCase(loaderData.lot.toLowerCase())}s</Text>
					</Tabs.Tab>
					<Tabs.Tab value="search" leftSection={<IconSearch size={24} />}>
						<Text>Search</Text>
					</Tabs.Tab>
					<Box ml="auto" visibleFrom="md">
						<Button
							component={Link}
							leftSection={<IconPhotoPlus />}
							to={$path("/media/create")}
							variant="transparent"
						>
							Create
						</Button>
					</Box>
				</Tabs.List>
			</Tabs>

			<Stack>
				{loaderData.mediaList ? (
					<>
						<Group wrap="nowrap">
							{SearchInput({
								placeholder: `Sift through your ${changeCase(
									loaderData.lot.toLowerCase(),
								).toLowerCase()}s`,
							})}
							<ActionIcon
								onClick={openFiltersModal}
								color={isFilterChanged ? "blue" : "gray"}
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
										<Title order={3}>Filters</Title>
										<ActionIcon
											onClick={() => {
												navigate(".");
												closeFiltersModal();
											}}
										>
											<IconFilterOff size={24} />
										</ActionIcon>
									</Group>
									<Select
										defaultValue={loaderData.mediaList.url.generalFilter}
										data={[
											{
												group: "General filters",
												items: Object.values(MediaGeneralFilter).map((o) => ({
													value: o.toString(),
													label: startCase(o.toLowerCase()),
												})),
											},
										]}
										onChange={(v) => {
											if (v) setP("generalFilter", v);
										}}
									/>
									<Flex gap="xs" align="center">
										<Select
											w="100%"
											data={[
												{
													group: "Sort by",
													items: Object.values(MediaSortBy).map((o) => ({
														value: o.toString(),
														label: startCase(o.toLowerCase()),
													})),
												},
											]}
											defaultValue={loaderData.mediaList.url.sortBy}
											onChange={(v) => {
												if (v) setP("sortBy", v);
											}}
										/>
										<ActionIcon
											onClick={() => {
												if (
													loaderData.mediaList?.url.sortOrder ===
													GraphqlSortOrder.Asc
												)
													setP("sortOrder", GraphqlSortOrder.Desc);
												else setP("sortOrder", GraphqlSortOrder.Asc);
											}}
										>
											{loaderData.mediaList.url.sortOrder ===
											GraphqlSortOrder.Asc ? (
												<IconSortAscending />
											) : (
												<IconSortDescending />
											)}
										</ActionIcon>
									</Flex>
									{loaderData.mediaList.collections.length > 0 ? (
										<Select
											placeholder="Select a collection"
											defaultValue={loaderData.mediaList.url.collectionFilter?.toString()}
											data={[
												{
													group: "My collections",
													items: loaderData.mediaList.collections.map((c) => ({
														value: c.id.toString(),
														label: c.name,
													})),
												},
											]}
											onChange={(v) => setP("collectionFilter", v)}
											clearable
										/>
									) : null}
								</Stack>
							</Modal>
						</Group>
						{loaderData.mediaList.list.details.total > 0 ? (
							<>
								<Box>
									<Text display="inline" fw="bold">
										{loaderData.mediaList.list.details.total}
									</Text>{" "}
									items found
								</Box>
								<ApplicationGrid>
									{loaderData.mediaList.list.items.map((lm) => (
										<MediaItemWithoutUpdateModal
											key={lm.data.identifier}
											item={{
												...lm.data,
												publishYear: lm.data.publishYear?.toString(),
											}}
											averageRating={lm.averageRating ?? undefined}
											lot={loaderData.lot}
											href={$path("/media/item/:id", {
												id: lm.data.identifier,
											})}
											reviewScale={loaderData.userPreferences.reviewScale}
										/>
									))}
								</ApplicationGrid>
							</>
						) : (
							<Text>You do not have any saved yet</Text>
						)}
						{loaderData.mediaList.list ? (
							<Center>
								<ApplicationPagination
									size="sm"
									defaultValue={loaderData.numPage}
									onChange={(v) => setP("page", v.toString())}
									total={Math.ceil(
										loaderData.mediaList.list.details.total /
											loaderData.coreDetails.pageLimit,
									)}
								/>
							</Center>
						) : null}
					</>
				) : null}
				{loaderData.mediaSearch ? (
					<>
						<Flex gap="xs">
							{SearchInput({
								placeholder: `Search for ${changeCase(
									loaderData.lot.toLowerCase(),
								).toLowerCase()}s`,
							})}
							{loaderData.mediaSearch.mediaSources.length > 1 ? (
								<Select
									w="37%"
									value={loaderData.mediaSearch.url.source}
									data={loaderData.mediaSearch.mediaSources.map((o) => ({
										value: o.toString(),
										label: startCase(o.toLowerCase()),
									}))}
									onChange={(v) => {
										if (v) setP("source", v);
									}}
								/>
							) : null}
						</Flex>
						{loaderData.mediaSearch.search.details.total > 0 ? (
							<>
								<Box>
									<Text display="inline" fw="bold">
										{loaderData.mediaSearch.search.details.total}
									</Text>{" "}
									items found
								</Box>
								<ApplicationGrid>
									{loaderData.mediaSearch.search.items.map((b, idx) => (
										<MediaSearchItem
											idx={idx}
											action={Action.Search}
											key={b.item.identifier}
											item={{
												...b.item,
												publishYear: b.item.publishYear?.toString(),
											}}
											maybeItemId={b.databaseId ?? undefined}
											hasInteracted={b.hasInteracted}
											query={query || ""}
											lot={loaderData.lot}
											source={
												loaderData.mediaSearch?.url.source ||
												MetadataSource.Anilist
											}
											reviewScale={loaderData.userPreferences.reviewScale}
										/>
									))}
								</ApplicationGrid>
							</>
						) : (
							<Text>No media found matching your query</Text>
						)}
						{loaderData.mediaSearch.search ? (
							<Center>
								<ApplicationPagination
									size="sm"
									defaultValue={loaderData.numPage}
									onChange={(v) => setP("page", v.toString())}
									total={Math.ceil(
										loaderData.mediaSearch.search.details.total /
											loaderData.coreDetails.pageLimit,
									)}
								/>
							</Center>
						) : null}
					</>
				) : null}
			</Stack>
		</Container>
	);
}
