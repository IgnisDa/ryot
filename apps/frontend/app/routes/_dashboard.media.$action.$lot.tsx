import {
	ActionIcon,
	Box,
	Button,
	Center,
	Container,
	Divider,
	Flex,
	Group,
	Menu,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import {
	EntityLot,
	GraphqlSortOrder,
	GridPacking,
	MediaGeneralFilter,
	MediaLot,
	MediaSortBy,
	MediaSource,
	MetadataSearchDocument,
	type MetadataSearchQuery,
	UserMetadataListDocument,
	type UserMetadataListInput,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	cloneDeep,
	isEqual,
	parseParameters,
	parseSearchQuery,
	startCase,
	zodIntAsString,
} from "@ryot/ts-utils";
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
import { Link, useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { z } from "zod";
import {
	ApplicationGrid,
	BulkEditingAffix,
	CollectionsFilter,
	DebouncedSearchInput,
	DisplayListDetailsAndRefresh,
	FiltersModal,
	ProRequiredAlert,
} from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import {
	ApplicationTimeRange,
	clientGqlService,
	convertEnumToSelectData,
	dayjsLib,
	getLot,
	getStartTimeFromRange,
	getVerb,
	pageQueryParam,
	refreshEntityDetails,
	Verb,
	zodCollectionFilter,
} from "~/lib/common";
import {
	useApplicationEvents,
	useAppSearchParam,
	useCoreDetails,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	OnboardingTourStepTargets,
	TOUR_MOVIE_TARGET_ID,
	useOnboardingTour,
} from "~/lib/state/general";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
} from "~/lib/state/media";
import {
	getCoreDetails,
	getSearchEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.media.$action.$lot";

export type SearchParams = {
	query?: string;
};

const defaultFilters = {
	mineCollections: [],
	mineSortBy: MediaSortBy.LastSeen,
	mineSortOrder: GraphqlSortOrder.Desc,
	mineGeneralFilter: MediaGeneralFilter.All,
	mineDateRange: ApplicationTimeRange.AllTime,
};

enum Action {
	List = "list",
	Search = "search",
}

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { action, lot } = parseParameters(
		params,
		z.object({
			action: z.nativeEnum(Action),
			lot: z.string().transform((v) => getLot(v) as MediaLot),
		}),
	);
	const cookieName = await getSearchEnhancedCookieName(
		`media.${action}.${lot}`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const schema = z.object({
		query: z.string().optional(),
		[pageQueryParam]: zodIntAsString.default("1"),
	});
	const query = parseSearchQuery(request, schema);
	const [
		totalResults,
		mediaList,
		mediaSearch,
		respectCoreDetailsPageSize,
		listInput,
	] = await match(action)
		.with(Action.List, async () => {
			const listSchema = z.object({
				collections: zodCollectionFilter,
				endDateRange: z.string().optional(),
				startDateRange: z.string().optional(),
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
			const urlParse = parseSearchQuery(request, listSchema);
			const input: UserMetadataListInput = {
				lot,
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
			};
			const { userMetadataList } = await serverGqlService.authenticatedRequest(
				request,
				UserMetadataListDocument,
				{ input },
			);
			return [
				userMetadataList.response.details.total,
				{ list: userMetadataList, url: urlParse },
				undefined,
				false,
				input,
			] as const;
		})
		.with(Action.Search, async () => {
			const coreDetails = await getCoreDetails();
			const metadataSourcesForLot = coreDetails.metadataLotSourceMappings.find(
				(m) => m.lot === lot,
			);
			invariant(metadataSourcesForLot);
			const searchSchema = z.object({
				source: z
					.nativeEnum(MediaSource)
					.default(metadataSourcesForLot.sources[0]),
			});
			const urlParse = parseSearchQuery(request, searchSchema);
			let metadataSearch: MetadataSearchQuery["metadataSearch"] | false;
			try {
				const response = await serverGqlService.authenticatedRequest(
					request,
					MetadataSearchDocument,
					{
						input: {
							lot,
							source: urlParse.source,
							search: { page: query[pageQueryParam], query: query.query },
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
				true,
				undefined,
			] as const;
		})
		.exhaustive();
	const url = new URL(request.url);
	const totalPages = await redirectToFirstPageIfOnInvalidPage({
		request,
		totalResults,
		respectCoreDetailsPageSize,
		currentPage: query[pageQueryParam],
	});
	return {
		lot,
		query,
		action,
		listInput,
		mediaList,
		totalPages,
		cookieName,
		mediaSearch,
		url: withoutHost(url.href),
		[pageQueryParam]: Number(query[pageQueryParam]),
	};
};

export const meta = ({ params }: Route.MetaArgs) => {
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
	const { isOnboardingTourInProgress, advanceOnboardingTourStep } =
		useOnboardingTour();

	const bulkEditingState = bulkEditingCollection.state;
	const mediaSearch = loaderData.mediaSearch;
	const areFiltersApplied =
		loaderData.mediaList?.url.generalFilter !==
			defaultFilters.mineGeneralFilter ||
		loaderData.mediaList?.url.sortOrder !== defaultFilters.mineSortOrder ||
		loaderData.mediaList?.url.sortBy !== defaultFilters.mineSortBy ||
		loaderData.mediaList?.url.dateRange !== defaultFilters.mineDateRange ||
		!isEqual(
			loaderData.mediaList?.url.collections,
			defaultFilters.mineCollections,
		);
	const isEligibleForNextTourStep =
		loaderData.lot === MediaLot.Movie && isOnboardingTourInProgress;

	return (
		<>
			<BulkEditingAffix
				bulkAddEntities={async () => {
					if (!loaderData.listInput) return [];
					const input = cloneDeep(loaderData.listInput);
					input.search = { ...input.search, take: Number.MAX_SAFE_INTEGER };
					return await clientGqlService
						.request(UserMetadataListDocument, { input })
						.then((r) =>
							r.userMetadataList.response.items.map((m) => ({
								entityId: m,
								entityLot: EntityLot.Metadata,
							})),
						);
				}}
			/>
			<Container>
				<Tabs
					mt="sm"
					variant="default"
					value={loaderData.action}
					onChange={(v) => {
						if (v) {
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
							if (v === "search" && isOnboardingTourInProgress) {
								advanceOnboardingTourStep();
							}
						}
					}}
				>
					<Tabs.List mb="xs" style={{ alignItems: "center" }}>
						<Tabs.Tab value="list" leftSection={<IconListCheck size={24} />}>
							<Text>My {changeCase(loaderData.lot.toLowerCase())}s</Text>
						</Tabs.Tab>
						<Tabs.Tab
							value="search"
							leftSection={<IconSearch size={24} />}
							className={OnboardingTourStepTargets.GoToMoviesSection}
						>
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
									color={areFiltersApplied ? "blue" : "gray"}
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
							<DisplayListDetailsAndRefresh
								cacheId={loaderData.mediaList.list.cacheId}
								total={loaderData.mediaList.list.response.details.total}
								className={OnboardingTourStepTargets.RefreshMoviesListPage}
							/>
							{(loaderData.mediaList?.url.startDateRange ||
								loaderData.mediaList?.url.endDateRange) &&
							!coreDetails.isServerKeyValidated ? (
								<ProRequiredAlert alertText="Ryot Pro is required to filter by dates" />
							) : loaderData.mediaList.list.response.details.total > 0 ? (
								<ApplicationGrid
									className={OnboardingTourStepTargets.ShowMoviesListPage}
								>
									{loaderData.mediaList.list.response.items.map((item) => {
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
									tourControl={{
										target: OnboardingTourStepTargets.SearchMovie,
										onQueryChange: (query) => {
											if (query === TOUR_MOVIE_TARGET_ID.toLowerCase()) {
												advanceOnboardingTourStep();
											}
										},
									}}
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
										{mediaSearch.search.items.map((b, index) => (
											<MediaSearchItem
												key={b}
												item={b}
												isFirstItem={index === 0}
												isEligibleForNextTourStep={isEligibleForNextTourStep}
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
		</>
	);
}

const MediaSearchItem = (props: {
	isFirstItem: boolean;
	isEligibleForNextTourStep: boolean;
	item: MetadataSearchQuery["metadataSearch"]["items"][number];
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const events = useApplicationEvents();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const gridPacking = userPreferences.general.gridPacking;
	const buttonSize =
		gridPacking === GridPacking.Normal ? "compact-md" : "compact-xs";

	const tourControlOne = props.isFirstItem
		? OnboardingTourStepTargets.AddMovieToWatchlist
		: undefined;

	const tourControlTwo = props.isFirstItem
		? OnboardingTourStepTargets.OpenMetadataProgressForm
		: undefined;

	const tourControlThree = props.isFirstItem
		? OnboardingTourStepTargets.GoToMoviesSectionAgain
		: undefined;

	return (
		<Box>
			<MetadataDisplayItem
				metadataId={props.item}
				shouldHighlightNameIfInteracted
				imageClassName={OnboardingTourStepTargets.GoToMoviesSectionAgain}
				onImageClickBehavior={async () => {
					if (tourControlThree) advanceOnboardingTourStep();
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
								onClick={() => {
									setAddEntityToCollectionsData({
										entityId: props.item,
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
					className={tourControlTwo}
					onClick={async () => {
						setMetadataToUpdate({ metadataId: props.item });
						if (tourControlTwo) {
							advanceOnboardingTourStep();
						}
					}}
				>
					Mark as {getVerb(Verb.Read, loaderData.lot)}
				</Button>
				<Button
					w="100%"
					mt="xs"
					variant="outline"
					size={buttonSize}
					className={tourControlOne}
					onClick={async () => {
						const form = new FormData();
						form.append("entityId", props.item);
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
						refreshEntityDetails(props.item);
						if (tourControlOne) {
							advanceOnboardingTourStep();
						}
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
				data={convertEnumToSelectData(MediaGeneralFilter)}
			/>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					data={[
						{
							group: "Sort by",
							items: convertEnumToSelectData(MediaSortBy),
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
			<Divider />
			<CollectionsFilter
				cookieName={loaderData.cookieName}
				applied={loaderData.mediaList.url.collections}
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
