import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Box,
	Button,
	Center,
	Container,
	Flex,
	Group,
	Menu,
	Modal,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
	Title,
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
	LatestUserSummaryDocument,
	MediaGeneralFilter,
	MediaLot,
	MediaSortBy,
	MediaSource,
	MetadataListDocument,
	MetadataSearchDocument,
	type UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
import {
	IconBoxMultiple,
	IconDotsVertical,
	IconFilter,
	IconFilterOff,
	IconListCheck,
	IconPhotoPlus,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import {
	AddEntityToCollectionModal,
	ApplicationGrid,
	DebouncedSearchInput,
} from "~/components/common";
import {
	type Item,
	MediaItemWithoutUpdateModal,
	NewUserGuideAlert,
	commitMedia,
} from "~/components/media";
import events from "~/lib/events";
import { Verb, getLot, getVerb } from "~/lib/generals";
import {
	useCoreDetails,
	useSearchParam,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useMetadataProgressUpdate } from "~/lib/media";
import {
	getAuthorizationHeader,
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
	const [{ latestUserSummary }] = await Promise.all([
		serverGqlService.request(
			LatestUserSummaryDocument,
			undefined,
			getAuthorizationHeader(request),
		),
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
				collection: z.string().optional(),
			});
			const { metadataList } = await serverGqlService.request(
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
					},
				},
				getAuthorizationHeader(request),
			);
			return [{ list: metadataList, url: urlParse }, undefined] as const;
		})
		.with(Action.Search, async () => {
			const metadataSourcesForLot = metadataMapping[lot];
			const urlParse = zx.parseQuery(request, {
				source: z.nativeEnum(MediaSource).default(metadataSourcesForLot[0]),
			});
			const { metadataSearch } = await serverGqlService.request(
				MetadataSearchDocument,
				{
					input: {
						lot,
						search: { page, query },
						source: urlParse.source,
					},
				},
				getAuthorizationHeader(request),
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
		mediaSearch,
		url: withoutHost(url.href),
		mediaInteractedWith: latestUserSummary.media.metadataOverall.interactedWith,
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
	const collections = useUserCollections();
	const [_, { setP }] = useSearchParam();
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
			{loaderData.mediaInteractedWith === 0 ? <NewUserGuideAlert /> : null}
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
								placeholder={`Sift through your ${changeCase(
									loaderData.lot.toLowerCase(),
								).toLowerCase()}s`}
								initialValue={loaderData.query}
							/>
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
									{collections.length > 0 ? (
										<Select
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
											mediaReason={lm.mediaReason}
											lot={loaderData.lot}
											href={$path("/media/item/:id", {
												id: lm.data.identifier,
											})}
											reviewScale={userPreferences.general.reviewScale}
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
											item={{
												...b.item,
												publishYear: b.item.publishYear?.toString(),
											}}
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
	item: Item;
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
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const basicCommit = async (e: React.MouseEvent) => {
		if (props.maybeItemId) return props.maybeItemId;
		e.preventDefault();
		setIsLoading(true);
		const response = await commitMedia(
			props.item.identifier,
			props.lot,
			props.source,
		);
		setIsLoading(false);
		return response;
	};
	const [
		isAddMediaToCollectionModalOpened,
		{
			open: openIsAddMediaToCollectionModalOpened,
			close: closeIsAddMediaToCollectionModalOpened,
		},
	] = useDisclosure(false);
	const [appItemId, setAppItemId] = useState(props.maybeItemId);

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			lot={props.lot}
			reviewScale={props.reviewScale}
			hasInteracted={props.hasInteracted}
			imageOverlayForLoadingIndicator={isLoading}
			noRatingLink
			noHref
			onClick={async (e) => {
				setIsLoading(true);
				const id = await basicCommit(e);
				setIsLoading(false);
				return navigate($path("/media/item/:id", { id }));
			}}
			nameRight={
				<>
					<Menu shadow="md">
						<Menu.Target>
							<ActionIcon size="xs">
								<IconDotsVertical />
							</ActionIcon>
						</Menu.Target>
						<Menu.Dropdown>
							<Menu.Item
								leftSection={<IconBoxMultiple size={14} />}
								onClick={async (e) => {
									if (!appItemId) {
										const id = await basicCommit(e);
										setAppItemId(id);
									}
									openIsAddMediaToCollectionModalOpened();
								}}
							>
								Add to collection
							</Menu.Item>
						</Menu.Dropdown>
					</Menu>
					{appItemId ? (
						<AddEntityToCollectionModal
							userId={userDetails.id}
							opened={isAddMediaToCollectionModalOpened}
							onClose={closeIsAddMediaToCollectionModalOpened}
							entityId={appItemId.toString()}
							entityLot={EntityLot.Media}
						/>
					) : null}
				</>
			}
		>
			<>
				<Button
					variant="outline"
					w="100%"
					size="compact-md"
					onClick={async (e) => {
						const metadataId = await basicCommit(e);
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
					onClick={async (e) => {
						setIsLoading(true);
						const id = await basicCommit(e);
						const form = new FormData();
						form.append("entityId", id);
						form.append("entityLot", EntityLot.Media);
						form.append("creatorUserId", userDetails.id);
						form.append("collectionName", "Watchlist");
						await fetch(
							$path("/actions", { intent: "addEntityToCollection" }),
							{ body: form, method: "POST", credentials: "include" },
						);
						events.addToCollection(EntityLot.Media);
						setIsLoading(false);
						revalidator.revalidate();
					}}
				>
					Add to Watchlist
				</Button>
			</>
		</MediaItemWithoutUpdateModal>
	);
};
