import {
	ActionIcon,
	Box,
	Button,
	Center,
	Checkbox,
	Container,
	Flex,
	Group,
	Loader,
	Menu,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import {
	Link,
	useLoaderData,
	useNavigate,
	useRevalidator,
} from "@remix-run/react";
import {
	EntityLot,
	GraphqlSortOrder,
	MediaGeneralFilter,
	MediaLot,
	MediaSortBy,
	MediaSource,
	MetadataListDocument,
	MetadataSearchDocument,
	type MetadataSearchQuery,
	type UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconBoxMultiple,
	IconDotsVertical,
	IconFilter,
	IconListCheck,
	IconPhotoPlus,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { useState } from "react";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common";
import { BaseMediaDisplayItem, MetadataDisplayItem } from "~/components/media";
import { Verb, getLot, getVerb } from "~/lib/generals";
import {
	useAppSearchParam,
	useApplicationEvents,
	useCoreDetails,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import {
	useAddEntityToCollection,
	useMetadataProgressUpdate,
} from "~/lib/state/media";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

export type SearchParams = {
	query?: string;
};

const defaultFilters = {
	mineCollection: undefined,
	mineGeneralFilter: MediaGeneralFilter.All,
	mineSortOrder: GraphqlSortOrder.Desc,
	mineSortBy: MediaSortBy.LastSeen,
};

enum Action {
	List = "list",
	Search = "search",
}

const metadataMapping = {
	[MediaLot.AudioBook]: [MediaSource.Audible],
	[MediaLot.Book]: [MediaSource.Openlibrary, MediaSource.GoogleBooks],
	[MediaLot.Podcast]: [MediaSource.Itunes, MediaSource.Listennotes],
	[MediaLot.VideoGame]: [MediaSource.Igdb],
	[MediaLot.Anime]: [MediaSource.Anilist, MediaSource.Mal],
	[MediaLot.Manga]: [
		MediaSource.Anilist,
		MediaSource.MangaUpdates,
		MediaSource.Mal,
	],
	[MediaLot.Movie]: [MediaSource.Tmdb],
	[MediaLot.Show]: [MediaSource.Tmdb],
	[MediaLot.VisualNovel]: [MediaSource.Vndb],
};

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { action, lot } = zx.parseParams(params, {
		action: z.nativeEnum(Action),
		lot: z.string().transform((v) => getLot(v) as MediaLot),
	});
	const cookieName = await getEnhancedCookieName(
		`media.${action}.${lot}`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const { query, page } = zx.parseQuery(request, {
		query: z.string().optional(),
		page: zx.IntAsString.default("1"),
	});
	const numPage = Number(page);
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
				collection: z.string().optional(),
				invertCollection: zx.BoolAsString.optional(),
			});
			const { metadataList } = await serverGqlService.authenticatedRequest(
				request,
				MetadataListDocument,
				{
					input: {
						lot,
						search: { page: numPage, query },
						sort: { order: urlParse.sortOrder, by: urlParse.sortBy },
						filter: {
							general: urlParse.generalFilter,
							collection: urlParse.collection,
						},
						invertCollection: urlParse.invertCollection,
					},
				},
			);
			return [{ list: metadataList, url: urlParse }, undefined] as const;
		})
		.with(Action.Search, async () => {
			const metadataSourcesForLot = metadataMapping[lot];
			const urlParse = zx.parseQuery(request, {
				source: z.nativeEnum(MediaSource).default(metadataSourcesForLot[0]),
			});
			const { metadataSearch } = await serverGqlService.authenticatedRequest(
				request,
				MetadataSearchDocument,
				{
					input: {
						lot,
						search: { page, query },
						source: urlParse.source,
					},
				},
			);
			return [
				undefined,
				{
					search: metadataSearch,
					url: urlParse,
					mediaSources: metadataSourcesForLot,
				},
			] as const;
		})
		.exhaustive();
	const url = new URL(request.url);
	return {
		lot,
		query,
		action,
		numPage,
		mediaList,
		cookieName,
		mediaSearch,
		url: withoutHost(url.href),
	};
});

export const meta = ({ params }: MetaArgs_SingleFetch<typeof loader>) => {
	return [
		{
			title: `${changeCase(params.action || "")} ${changeCase(
				params.lot?.toLowerCase() || "",
			)}s | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const navigate = useNavigate();

	const isFilterChanged =
		loaderData.mediaList?.url.generalFilter !==
			defaultFilters.mineGeneralFilter ||
		loaderData.mediaList?.url.sortOrder !== defaultFilters.mineSortOrder ||
		loaderData.mediaList?.url.sortBy !== defaultFilters.mineSortBy ||
		loaderData.mediaList?.url.collection !== defaultFilters.mineCollection;

	return (
		<Container>
			<Tabs
				variant="default"
				mt="sm"
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
							<DebouncedSearchInput
								initialValue={loaderData.query}
								enhancedQueryParams={loaderData.cookieName}
								placeholder={`Sift through your ${changeCase(
									loaderData.lot.toLowerCase(),
								).toLowerCase()}s`}
							/>
							<ActionIcon
								onClick={openFiltersModal}
								color={isFilterChanged ? "blue" : "gray"}
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
									{loaderData.mediaList.list.items.map((item) => (
										<MetadataDisplayItem
											key={item}
											metadataId={item}
											rightLabelHistory
										/>
									))}
								</ApplicationGrid>
							</>
						) : (
							<Text>You do not have any saved yet</Text>
						)}
						{loaderData.mediaList.list ? (
							<Center>
								<Pagination
									size="sm"
									value={loaderData.numPage}
									onChange={(v) => setP("page", v.toString())}
									total={Math.ceil(
										loaderData.mediaList.list.details.total /
											coreDetails.pageLimit,
									)}
								/>
							</Center>
						) : null}
					</>
				) : null}
				{loaderData.mediaSearch ? (
					<>
						<Flex gap="xs">
							<DebouncedSearchInput
								placeholder={`Sift through your ${changeCase(
									loaderData.lot.toLowerCase(),
								).toLowerCase()}s`}
								initialValue={loaderData.query}
								enhancedQueryParams={loaderData.cookieName}
							/>
							{loaderData.mediaSearch.mediaSources.length > 1 ? (
								<Select
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
											item={b}
											maybeItemId={b.databaseId ?? undefined}
											hasInteracted={b.hasInteracted}
											lot={loaderData.lot}
											source={
												loaderData.mediaSearch?.url.source ||
												MediaSource.Anilist
											}
											reviewScale={userPreferences.general.reviewScale}
										/>
									))}
								</ApplicationGrid>
							</>
						) : (
							<Text>No media found matching your query</Text>
						)}
						{loaderData.mediaSearch.search ? (
							<Center>
								<Pagination
									size="sm"
									value={loaderData.numPage}
									onChange={(v) => setP("page", v.toString())}
									total={Math.ceil(
										loaderData.mediaSearch.search.details.total /
											coreDetails.pageLimit,
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

const MediaSearchItem = (props: {
	item: MetadataSearchQuery["metadataSearch"]["items"][number];
	idx: number;
	lot: MediaLot;
	source: MediaSource;
	action: "search" | "list";
	hasInteracted: boolean;
	reviewScale: UserReviewScale;
	maybeItemId?: string;
}) => {
	const navigate = useNavigate();
	const userDetails = useUserDetails();
	const [isLoading, setIsLoading] = useState(false);
	const revalidator = useRevalidator();
	const events = useApplicationEvents();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();
	const basicCommit = async () => {
		if (props.maybeItemId) return props.maybeItemId;
		setIsLoading(true);
		const data = new FormData();
		data.append("identifier", props.item.item.identifier);
		data.append("lot", props.lot);
		data.append("source", props.source);
		const resp = await fetch($path("/actions", { intent: "commitMedia" }), {
			method: "POST",
			body: data,
		});
		const json = await resp.json();
		const response = json.commitMedia.id;
		setIsLoading(false);
		return response;
	};

	return (
		<Box>
			<BaseMediaDisplayItem
				isLoading={false}
				name={props.item.item.title}
				onImageClickBehavior={async () => {
					setIsLoading(true);
					const id = await basicCommit();
					setIsLoading(false);
					navigate($path("/media/item/:id", { id }));
				}}
				labels={{
					left: props.item.item.publishYear,
					right: (
						<Text c={props.hasInteracted ? "yellow" : undefined}>
							{changeCase(snakeCase(props.lot))}
						</Text>
					),
				}}
				imageUrl={props.item.item.image}
				imageOverlay={{
					topLeft: isLoading ? (
						<Loader color="red" variant="bars" size="sm" m={2} />
					) : null,
				}}
				nameRight={
					<Menu shadow="md">
						<Menu.Target>
							<ActionIcon size="xs">
								<IconDotsVertical />
							</ActionIcon>
						</Menu.Target>
						<Menu.Dropdown>
							<Menu.Item
								leftSection={<IconBoxMultiple size={14} />}
								onClick={async () => {
									const id = await basicCommit();
									setAddEntityToCollectionData({
										entityId: id,
										entityLot: EntityLot.Metadata,
									});
								}}
							>
								Add to collection
							</Menu.Item>
						</Menu.Dropdown>
					</Menu>
				}
			/>
			<Box px={4}>
				<Button
					variant="outline"
					w="100%"
					size="compact-md"
					onClick={async () => {
						const metadataId = await basicCommit();
						setMetadataToUpdate({ metadataId });
					}}
				>
					Mark as {getVerb(Verb.Read, props.lot)}
				</Button>
				<Button
					mt="xs"
					variant="outline"
					w="100%"
					size="compact-md"
					onClick={async () => {
						setIsLoading(true);
						const id = await basicCommit();
						const form = new FormData();
						form.append("entityId", id);
						form.append("entityLot", EntityLot.Metadata);
						form.append("creatorUserId", userDetails.id);
						form.append("collectionName", "Watchlist");
						await fetch(
							$path("/actions", { intent: "addEntityToCollection" }),
							{
								body: form,
								method: "POST",
								credentials: "include",
							},
						);
						events.addToCollection(EntityLot.Metadata);
						setIsLoading(false);
						revalidator.revalidate();
					}}
				>
					Add to Watchlist
				</Button>
			</Box>
		</Box>
	);
};

const FiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
	const collections = useUserCollections();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	if (!loaderData.mediaList) return null;

	return (
		<>
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
						if (loaderData.mediaList?.url.sortOrder === GraphqlSortOrder.Asc)
							setP("sortOrder", GraphqlSortOrder.Desc);
						else setP("sortOrder", GraphqlSortOrder.Asc);
					}}
				>
					{loaderData.mediaList.url.sortOrder === GraphqlSortOrder.Asc ? (
						<IconSortAscending />
					) : (
						<IconSortDescending />
					)}
				</ActionIcon>
			</Flex>
			<Flex gap="xs" align="center">
				<Select
					flex={1}
					placeholder="Select a collection"
					defaultValue={loaderData.mediaList.url.collection?.toString()}
					data={[
						{
							group: "My collections",
							items: collections.map((c) => ({
								value: c.id.toString(),
								label: c.name,
							})),
						},
					]}
					onChange={(v) => setP("collection", v)}
					clearable
					searchable
				/>
				<Checkbox
					label="Invert"
					checked={loaderData.mediaList.url.invertCollection}
					onChange={(e) => setP("invertCollection", String(e.target.checked))}
				/>
			</Flex>
		</>
	);
};
