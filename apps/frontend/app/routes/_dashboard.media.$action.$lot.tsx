import {
	ActionIcon,
	Box,
	Button,
	Checkbox,
	Container,
	Divider,
	Flex,
	Group,
	MultiSelect,
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
	IconPhotoPlus,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import {
	ApplicationPagination,
	BulkCollectionEditingAffix,
	DisplayListDetailsAndRefresh,
	ProRequiredAlert,
} from "~/components/common";
import {
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { pageQueryParam } from "~/lib/shared/constants";
import { dayjsLib, getStartTimeFromRange } from "~/lib/shared/date-utils";
import { useAppSearchParam, useCoreDetails } from "~/lib/shared/hooks";
import { getLot } from "~/lib/shared/media-utils";
import { clientGqlService } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	isFilterChanged,
} from "~/lib/shared/ui-utils";
import {
	zodCollectionFilter,
	zodCommaDelimitedString,
} from "~/lib/shared/validation";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	OnboardingTourStepTargets,
	TOUR_METADATA_TARGET_ID,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { ApplicationTimeRange } from "~/lib/types";
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

const defaultMineFilters = {
	collections: [],
	sortBy: MediaSortBy.LastUpdated,
	sortOrder: GraphqlSortOrder.Desc,
	generalFilter: MediaGeneralFilter.All,
	dateRange: ApplicationTimeRange.AllTime,
};

const searchSchema = z.object({
	igdbThemeIds: zodCommaDelimitedString.optional(),
	igdbGenreIds: zodCommaDelimitedString.optional(),
	igdbGameTypeIds: zodCommaDelimitedString.optional(),
	igdbPlatformIds: zodCommaDelimitedString.optional(),
	igdbGameModeIds: zodCommaDelimitedString.optional(),
	googleBooksPassRawQuery: zodBoolAsString.optional(),
	igdbAllowGamesWithParent: zodBoolAsString.optional(),
	igdbReleaseDateRegionIds: zodCommaDelimitedString.optional(),
});

enum Action {
	List = "list",
	Search = "search",
}

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { action, lot } = parseParameters(
		params,
		z.object({
			action: z.enum(Action),
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
		[pageQueryParam]: zodIntAsString.default(1),
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
				sortBy: z.enum(MediaSortBy).default(defaultMineFilters.sortBy),
				dateRange: z
					.enum(ApplicationTimeRange)
					.default(defaultMineFilters.dateRange),
				sortOrder: z
					.enum(GraphqlSortOrder)
					.default(defaultMineFilters.sortOrder),
				generalFilter: z
					.enum(MediaGeneralFilter)
					.default(defaultMineFilters.generalFilter),
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
			const searchSchemaWithDefaults = searchSchema.extend({
				source: z.enum(MediaSource).default(metadataSourcesForLot.sources[0]),
			});
			const urlParse = parseSearchQuery(request, searchSchemaWithDefaults);
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
							sourceSpecifics: {
								googleBooks: { passRawQuery: urlParse.googleBooksPassRawQuery },
								igdb: {
									filters: {
										themeIds: urlParse.igdbThemeIds,
										genreIds: urlParse.igdbGenreIds,
										platformIds: urlParse.igdbPlatformIds,
										gameModeIds: urlParse.igdbGameModeIds,
										gameTypeIds: urlParse.igdbGameTypeIds,
										releaseDateRegionIds: urlParse.igdbReleaseDateRegionIds,
										allowGamesWithParent: urlParse.igdbAllowGamesWithParent,
									},
								},
							},
						},
					},
				);
				metadataSearch = response.metadataSearch;
			} catch {
				metadataSearch = false;
			}
			return [
				metadataSearch === false ? 0 : metadataSearch.response.details.total,
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

interface IgdbMultiselectProps {
	label: string;
	valueKey: string;
	value?: string[];
	data: Array<{ id: number; name: string }>;
}

const IgdbMultiselect = (props: IgdbMultiselectProps) => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	return (
		<MultiSelect
			size="xs"
			clearable
			searchable
			hidePickedOptions
			label={props.label}
			value={props.value}
			onChange={(v) => setP(props.valueKey, v.join(","))}
			data={props.data.map((item) => ({
				label: item.name,
				value: item.id.toString(),
			}))}
		/>
	);
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [
		searchFiltersModalOpened,
		{ open: openSearchFiltersModal, close: closeSearchFiltersModal },
	] = useDisclosure(false);
	const navigate = useNavigate();
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const mediaSearch = loaderData.mediaSearch;
	const areListFiltersActive = isFilterChanged(
		loaderData.mediaList?.url,
		defaultMineFilters,
	);

	const isEligibleForNextTourStep = loaderData.lot === MediaLot.AudioBook;

	return (
		<>
			<BulkCollectionEditingAffix
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
							if (v === "search") {
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
							className={OnboardingTourStepTargets.GoToAudiobooksSection}
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
									color={areListFiltersActive ? "blue" : "gray"}
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
								isRandomSortOrderSelected={
									loaderData.mediaList.url.sortBy === MediaSortBy.Random
								}
							/>
							{(loaderData.mediaList?.url.startDateRange ||
								loaderData.mediaList?.url.endDateRange) &&
							!coreDetails.isServerKeyValidated ? (
								<ProRequiredAlert alertText="Ryot Pro is required to filter by dates" />
							) : loaderData.mediaList.list.response.details.total > 0 ? (
								<ApplicationGrid
									className={OnboardingTourStepTargets.ShowAudiobooksListPage}
								>
									{loaderData.mediaList.list.response.items.map((item) => (
										<MediaListItem key={item} item={item} />
									))}
								</ApplicationGrid>
							) : (
								<Text>You do not have any saved yet</Text>
							)}
							{loaderData.mediaList.list ? (
								<ApplicationPagination
									total={loaderData.totalPages}
									value={loaderData[pageQueryParam]}
									onChange={(v) => setP(pageQueryParam, v.toString())}
								/>
							) : null}
						</>
					) : null}
					{mediaSearch ? (
						<>
							<Flex gap="xs" direction={{ base: "column", md: "row" }}>
								<DebouncedSearchInput
									initialValue={loaderData.query.query}
									enhancedQueryParams={loaderData.cookieName}
									placeholder={`Sift through your ${changeCase(
										loaderData.lot.toLowerCase(),
									).toLowerCase()}s`}
									tourControl={{
										target: OnboardingTourStepTargets.SearchAudiobook,
										onQueryChange: (query) => {
											if (query === TOUR_METADATA_TARGET_ID.toLowerCase()) {
												advanceOnboardingTourStep();
											}
										},
									}}
								/>
								<Group gap="xs" wrap="nowrap">
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
									<ActionIcon onClick={openSearchFiltersModal} color="gray">
										<IconFilter size={24} />
									</ActionIcon>
									<FiltersModal
										opened={searchFiltersModalOpened}
										cookieName={loaderData.cookieName}
										closeFiltersModal={closeSearchFiltersModal}
									>
										<SearchFiltersModalForm />
									</FiltersModal>
								</Group>
							</Flex>
							{mediaSearch.search === false ? (
								<Text>
									Something is wrong. Please try with an alternate provider.
								</Text>
							) : mediaSearch.search.response.details.total > 0 ? (
								<>
									<Box>
										<Text display="inline" fw="bold">
											{mediaSearch.search.response.details.total}
										</Text>{" "}
										items found
									</Box>
									<ApplicationGrid>
										{mediaSearch.search.response.items.map((b, index) => (
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
								<ApplicationPagination
									total={loaderData.totalPages}
									value={loaderData[pageQueryParam]}
									onChange={(v) => setP(pageQueryParam, v.toString())}
								/>
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
	item: MetadataSearchQuery["metadataSearch"]["response"]["items"][number];
}) => {
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const tourControlTwo = props.isFirstItem
		? OnboardingTourStepTargets.OpenMetadataProgressForm
		: undefined;

	const tourControlThree = props.isFirstItem
		? OnboardingTourStepTargets.GoToAudiobooksSectionAgain
		: undefined;

	return (
		<MetadataDisplayItem
			metadataId={props.item}
			shouldHighlightNameIfInteracted
			bottomRightImageOverlayClassName={tourControlTwo}
			imageClassName={OnboardingTourStepTargets.GoToAudiobooksSectionAgain}
			onImageClickBehavior={async () => {
				if (tourControlThree) advanceOnboardingTourStep();
			}}
		/>
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

const SearchFiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const coreDetails = useCoreDetails();

	if (!loaderData.mediaSearch) return null;

	return (
		<Stack gap="xs">
			{loaderData.mediaSearch.url.source === MediaSource.GoogleBooks ? (
				<Checkbox
					label="Pass raw query"
					checked={loaderData.mediaSearch.url.googleBooksPassRawQuery}
					onChange={(e) =>
						setP("googleBooksPassRawQuery", String(e.target.checked))
					}
				/>
			) : null}
			{loaderData.mediaSearch.url.source === MediaSource.Igdb ? (
				<>
					<IgdbMultiselect
						label="Select themes"
						valueKey="igdbThemeIds"
						value={loaderData.mediaSearch.url.igdbThemeIds}
						data={coreDetails.providerSpecifics.igdb.themes}
					/>
					<IgdbMultiselect
						label="Select genres"
						valueKey="igdbGenreIds"
						value={loaderData.mediaSearch.url.igdbGenreIds}
						data={coreDetails.providerSpecifics.igdb.genres}
					/>
					<IgdbMultiselect
						label="Select platforms"
						valueKey="igdbPlatformIds"
						value={loaderData.mediaSearch.url.igdbPlatformIds}
						data={coreDetails.providerSpecifics.igdb.platforms}
					/>
					<IgdbMultiselect
						label="Select game types"
						valueKey="igdbGameTypeIds"
						value={loaderData.mediaSearch.url.igdbGameTypeIds}
						data={coreDetails.providerSpecifics.igdb.gameTypes}
					/>
					<IgdbMultiselect
						label="Select game modes"
						valueKey="igdbGameModeIds"
						value={loaderData.mediaSearch.url.igdbGameModeIds}
						data={coreDetails.providerSpecifics.igdb.gameModes}
					/>
					<IgdbMultiselect
						label="Select release regions"
						valueKey="igdbReleaseDateRegionIds"
						value={loaderData.mediaSearch.url.igdbReleaseDateRegionIds}
						data={coreDetails.providerSpecifics.igdb.releaseDateRegions}
					/>
					<Checkbox
						label="Allow games with parent"
						checked={loaderData.mediaSearch.url.igdbAllowGamesWithParent}
						onChange={(e) =>
							setP("igdbAllowGamesWithParent", String(e.target.checked))
						}
					/>
				</>
			) : null}
		</Stack>
	);
};

type MediaListItemProps = {
	item: string;
};

const MediaListItem = (props: MediaListItemProps) => {
	const bulkEditingCollection = useBulkEditCollection();
	const bulkEditingState = bulkEditingCollection.state;

	const becItem = { entityId: props.item, entityLot: EntityLot.Metadata };
	const isAlreadyPresent = bulkEditingCollection.isAlreadyPresent(becItem);
	const isAdded = bulkEditingCollection.isAdded(becItem);

	return (
		<MetadataDisplayItem
			rightLabelHistory
			metadataId={props.item}
			topRight={
				bulkEditingState &&
				bulkEditingState.data.action === "add" &&
				!isAlreadyPresent ? (
					<ActionIcon
						color="green"
						variant={isAdded ? "filled" : "transparent"}
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
};
