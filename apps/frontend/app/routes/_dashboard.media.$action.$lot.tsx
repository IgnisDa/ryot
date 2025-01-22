import {
	ActionIcon,
	Box,
	Button,
	Center,
	Container,
	Divider,
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
import { DatePickerInput } from "@mantine/dates";
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
	type MediaLot,
	MediaSortBy,
	MediaSource,
	MetadataListDocument,
	MetadataSearchDocument,
	type MetadataSearchQuery,
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
	ProRequiredAlert,
} from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import {
	ApplicationTimeRange,
	Verb,
	commaDelimitedString,
	dayjsLib,
	getLot,
	getStartTimeFromRange,
	getVerb,
	pageQueryParam,
} from "~/lib/generals";
import {
	useAppSearchParam,
	useApplicationEvents,
	useCoreDetails,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	useAddEntityToCollection,
	useMetadataProgressUpdate,
} from "~/lib/state/media";
import {
	getCoreDetails,
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
	mineSortBy: MediaSortBy.LastSeen,
	mineSortOrder: GraphqlSortOrder.Desc,
	mineGeneralFilter: MediaGeneralFilter.All,
	mineDateRange: ApplicationTimeRange.AllTime,
};

enum Action {
	List = "list",
	Search = "search",
}

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
				collections: commaDelimitedString,
				endDateRange: z.string().optional(),
				startDateRange: z.string().optional(),
				invertCollection: zx.BoolAsString.optional(),
				sortBy: z.nativeEnum(MediaSortBy).default(defaultFilters.mineSortBy),
				dateRange: z
					.nativeEnum(ApplicationTimeRange)
					.default(defaultFilters.mineDateRange),
				sortOrder: z
					.nativeEnum(GraphqlSortOrder)
					.default(defaultFilters.mineSortOrder),
				generalFilter: z
					.nativeEnum(MediaGeneralFilter)
					.default(defaultFilters.mineGeneralFilter),
			});
			const { metadataList } = await serverGqlService.authenticatedRequest(
				request,
				MetadataListDocument,
				{
					input: {
						lot,
						invertCollection: urlParse.invertCollection,
						sort: { order: urlParse.sortOrder, by: urlParse.sortBy },
						search: { page: query[pageQueryParam], query: query.query },
						filter: {
							general: urlParse.generalFilter,
							collections: urlParse.collections,
							dateRange: {
								endDate: urlParse.endDateRange,
								startDate: urlParse.startDateRange,
							},
						},
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
			const coreDetails = await getCoreDetails();
			const metadataSourcesForLot = coreDetails.metadataLotSourceMappings.find(
				(m) => m.lot === lot,
			);
			if (!metadataSourcesForLot) throw new Error("Mapping not found");
			const urlParse = zx.parseQuery(request, {
				source: z
					.nativeEnum(MediaSource)
					.default(metadataSourcesForLot.sources[0]),
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
					url: urlParse,
					search: metadataSearch,
					mediaSources: metadataSourcesForLot.sources,
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
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const navigate = useNavigate();
	const bulkEditingCollection = useBulkEditCollection();

	const bulkEditingState = bulkEditingCollection.state;
	const mediaSearch = loaderData.mediaSearch;
	const isFilterChanged =
		loaderData.mediaList?.url.generalFilter !==
			defaultFilters.mineGeneralFilter ||
		loaderData.mediaList?.url.sortOrder !== defaultFilters.mineSortOrder ||
		loaderData.mediaList?.url.sortBy !== defaultFilters.mineSortBy ||
		loaderData.mediaList?.url.collections !== defaultFilters.mineCollection ||
		loaderData.mediaList?.url.dateRange !== defaultFilters.mineDateRange;

	return (
		<Container>
			<Tabs
				mt="sm"
				variant="default"
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
							to={$path(
								"/media/update/:action",
								{ action: "create" },
								{ lot: loaderData.lot },
							)}
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
								opened={filtersModalOpened}
								cookieName={loaderData.cookieName}
								closeFiltersModal={closeFiltersModal}
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
								{(loaderData.mediaList?.url.startDateRange ||
									loaderData.mediaList?.url.endDateRange) &&
								!coreDetails.isServerKeyValidated ? (
									<ProRequiredAlert alertText="Ryot Pro is required to filter by dates" />
								) : (
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
								)}
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
				{mediaSearch ? (
					<>
						<Flex gap="xs">
							<DebouncedSearchInput
								initialValue={loaderData.query.query}
								enhancedQueryParams={loaderData.cookieName}
								placeholder={`Sift through your ${changeCase(
									loaderData.lot.toLowerCase(),
								).toLowerCase()}s`}
							/>
							{mediaSearch.mediaSources.length > 1 ? (
								<Select
									value={mediaSearch.url.source}
									onChange={(v) => {
										if (v) setP("source", v);
									}}
									data={mediaSearch.mediaSources.map((o) => ({
										value: o.toString(),
										label: startCase(o.toLowerCase()),
									}))}
								/>
							) : null}
						</Flex>
						{mediaSearch.search === false ? (
							<Text>
								Something is wrong. Please try with an alternate provider.
							</Text>
						) : mediaSearch.search.details.total > 0 ? (
							<>
								<Box>
									<Text display="inline" fw="bold">
										{mediaSearch.search.details.total}
									</Text>{" "}
									items found
								</Box>
								<ApplicationGrid>
									{mediaSearch.search.items.map((b) => (
										<MediaSearchItem
											item={b}
											key={b.identifier}
											source={mediaSearch.url.source}
										/>
									))}
								</ApplicationGrid>
							</>
						) : (
							<Text>No media found matching your query</Text>
						)}
						{mediaSearch.search ? (
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
	source: MediaSource;
	item: MetadataSearchQuery["metadataSearch"]["items"][number];
}) => {
	const navigate = useNavigate();
	const loaderData = useLoaderData<typeof loader>();
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const gridPacking = userPreferences.general.gridPacking;
	const [isLoading, setIsLoading] = useState(false);
	const revalidator = useRevalidator();
	const events = useApplicationEvents();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();

	const buttonSize =
		gridPacking === GridPacking.Normal ? "compact-md" : "compact-xs";

	const basicCommit = async () => {
		setIsLoading(true);
		const data = new FormData();
		data.append("name", props.item.title);
		data.append("identifier", props.item.identifier);
		data.append("lot", loaderData.lot);
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
				name={props.item.title}
				imageUrl={props.item.image}
				labels={{
					left: props.item.publishYear,
					right: <Text>{changeCase(snakeCase(loaderData.lot))}</Text>,
				}}
				imageOverlay={{
					topLeft: isLoading ? (
						<Loader color="red" variant="bars" size="sm" m={2} />
					) : null,
				}}
				onImageClickBehavior={async () => {
					setIsLoading(true);
					const id = await basicCommit();
					setIsLoading(false);
					navigate($path("/media/item/:id", { id }));
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
					Mark as {getVerb(Verb.Read, loaderData.lot)}
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
				onChange={(v) => {
					if (v) setP("generalFilter", v);
				}}
				data={Object.values(MediaGeneralFilter).map((o) => ({
					value: o.toString(),
					label: startCase(o.toLowerCase()),
				}))}
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
			<Divider />
			<Stack gap="xs">
				<Select
					size="xs"
					description="Finished between time range"
					data={Object.values(ApplicationTimeRange)}
					defaultValue={loaderData.mediaList.url.dateRange}
					onChange={(v) => {
						const range = v as ApplicationTimeRange;
						const startDateRange = getStartTimeFromRange(range);
						setP("dateRange", v);
						if (range === ApplicationTimeRange.Custom) return;
						setP("startDateRange", startDateRange?.format("YYYY-MM-DD") || "");
						setP(
							"endDateRange",
							range === ApplicationTimeRange.AllTime
								? ""
								: dayjsLib().format("YYYY-MM-DD"),
						);
					}}
				/>
				{loaderData.mediaList.url.dateRange === ApplicationTimeRange.Custom ? (
					<DatePickerInput
						size="xs"
						type="range"
						description="Select custom dates"
						defaultValue={
							loaderData.mediaList.url.startDateRange &&
							loaderData.mediaList.url.endDateRange
								? [
										new Date(loaderData.mediaList.url.startDateRange),
										new Date(loaderData.mediaList.url.endDateRange),
									]
								: undefined
						}
						onChange={(v) => {
							const start = v[0];
							const end = v[1];
							if (!start || !end) return;
							setP("startDateRange", dayjsLib(start).format("YYYY-MM-DD"));
							setP("endDateRange", dayjsLib(end).format("YYYY-MM-DD"));
						}}
					/>
				) : null}
			</Stack>
		</>
	);
};
