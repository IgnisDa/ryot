import {
	ActionIcon,
	Box,
	Button,
	Center,
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
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import {
	Link,
	useLoaderData,
	useNavigate,
	useRevalidator,
} from "@remix-run/react";
import {
	EntityLot,
	GraphqlSortOrder,
	GridPacking,
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
	IconCheck,
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
	BaseMediaDisplayItem,
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import {
	Verb,
	commaDelimitedString,
	getLot,
	getVerb,
	pageQueryParam,
} from "~/lib/generals";
import {
	useAppSearchParam,
	useApplicationEvents,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	useAddEntityToCollection,
	useMetadataProgressUpdate,
} from "~/lib/state/media";
import {
	getEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const { action, lot } = zx.parseParams(params, {
		action: z.nativeEnum(Action),
		lot: z.string().transform((v) => getLot(v) as MediaLot),
	});
	const cookieName = await getEnhancedCookieName(
		`media.${action}.${lot}`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, {
		query: z.string().optional(),
		[pageQueryParam]: zx.IntAsString.default("1"),
	});
	const [totalResults, mediaList, mediaSearch] = await match(action)
		.with(Action.List, async () => {
			const urlParse = zx.parseQuery(request, {
				sortOrder: z
					.nativeEnum(GraphqlSortOrder)
					.default(defaultFilters.mineSortOrder),
				sortBy: z.nativeEnum(MediaSortBy).default(defaultFilters.mineSortBy),
				generalFilter: z
					.nativeEnum(MediaGeneralFilter)
					.default(defaultFilters.mineGeneralFilter),
				collections: commaDelimitedString,
				invertCollection: zx.BoolAsString.optional(),
			});
			const { metadataList } = await serverGqlService.authenticatedRequest(
				request,
				MetadataListDocument,
				{
					input: {
						lot,
						search: { page: query[pageQueryParam], query: query.query },
						sort: { order: urlParse.sortOrder, by: urlParse.sortBy },
						filter: {
							general: urlParse.generalFilter,
							collections: urlParse.collections,
						},
						invertCollection: urlParse.invertCollection,
					},
				},
			);
			return [
				metadataList.details.total,
				{ list: metadataList, url: urlParse },
				undefined,
			] as const;
		})
		.with(Action.Search, async () => {
			const metadataSourcesForLot = metadataMapping[lot];
			const urlParse = zx.parseQuery(request, {
				source: z.nativeEnum(MediaSource).default(metadataSourcesForLot[0]),
			});
			let metadataSearch: MetadataSearchQuery["metadataSearch"] | false;
			try {
				const response = await serverGqlService.authenticatedRequest(
					request,
					MetadataSearchDocument,
					{
						input: {
							lot,
							search: { page: query[pageQueryParam], query: query.query },
							source: urlParse.source,
						},
					},
				);
				metadataSearch = response.metadataSearch;
			} catch {
				metadataSearch = false;
			}
			return [
				metadataSearch === false ? 0 : metadataSearch.details.total,
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
	const totalPages = await redirectToFirstPageIfOnInvalidPage(
		request,
		totalResults,
		query[pageQueryParam],
	);
	return {
		lot,
		query,
		action,
		mediaList,
		totalPages,
		cookieName,
		mediaSearch,
		url: withoutHost(url.href),
		[pageQueryParam]: Number(query[pageQueryParam]),
	};
};

export const meta = ({ params }: MetaArgs<typeof loader>) => {
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
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const navigate = useNavigate();
	const bulkEditingCollection = useBulkEditCollection();
	const bulkEditingState = bulkEditingCollection.state;

	const isFilterChanged =
		loaderData.mediaList?.url.generalFilter !==
			defaultFilters.mineGeneralFilter ||
		loaderData.mediaList?.url.sortOrder !== defaultFilters.mineSortOrder ||
		loaderData.mediaList?.url.sortBy !== defaultFilters.mineSortBy ||
		loaderData.mediaList?.url.collections !== defaultFilters.mineCollection;

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
								{
									...(loaderData.query.query && {
										query: loaderData.query.query,
									}),
								},
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
							variant="transparent"
							leftSection={<IconPhotoPlus />}
							to={$path("/media/create", { lot: loaderData.lot })}
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
								initialValue={loaderData.query.query}
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
									{loaderData.mediaList.list.items.map((item) => {
										const becItem = {
											entityId: item,
											entityLot: EntityLot.Metadata,
										};
										const isAdded = bulkEditingCollection.isAdded(becItem);
										return (
											<MetadataDisplayItem
												key={item}
												metadataId={item}
												rightLabelHistory
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
							</>
						) : (
							<Text>You do not have any saved yet</Text>
						)}
						{loaderData.mediaList.list ? (
							<Center>
								<Pagination
									size="sm"
									total={loaderData.totalPages}
									value={loaderData[pageQueryParam]}
									onChange={(v) => setP(pageQueryParam, v.toString())}
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
								initialValue={loaderData.query.query}
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
						{loaderData.mediaSearch.search === false ? (
							<Text>
								Something is wrong. Please try with an alternate provider.
							</Text>
						) : loaderData.mediaSearch.search.details.total > 0 ? (
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
									total={loaderData.totalPages}
									value={loaderData[pageQueryParam]}
									onChange={(v) => setP(pageQueryParam, v.toString())}
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
	const userPreferences = useUserPreferences();
	const gridPacking = userPreferences.general.gridPacking;
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

	const buttonSize =
		gridPacking === GridPacking.Normal ? "compact-md" : "compact-xs";
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
					w="100%"
					variant="outline"
					size={buttonSize}
					onClick={async () => {
						const metadataId = await basicCommit();
						setMetadataToUpdate({ metadataId });
					}}
				>
					Mark as {getVerb(Verb.Read, props.lot)}
				</Button>
				<Button
					w="100%"
					mt="xs"
					variant="outline"
					size={buttonSize}
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
					Add to watchlist
				</Button>
			</Box>
		</Box>
	);
};

const FiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
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
			<CollectionsFilter
				cookieName={loaderData.cookieName}
				collections={loaderData.mediaList.url.collections}
				invertCollection={loaderData.mediaList.url.invertCollection}
			/>
		</>
	);
};
