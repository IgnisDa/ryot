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
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	isEqual,
	parseParameters,
	parseSearchQuery,
	snakeCase,
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
import { useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { z } from "zod";
import {
	ApplicationGrid,
	BaseMediaDisplayItem,
	CollectionsFilter,
	DebouncedSearchInput,
	DisplayListDetailsAndRefresh,
	FiltersModal,
	ProRequiredAlert,
} from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import {
	ApplicationTimeRange,
	Verb,
	dayjsLib,
	getLot,
	getStartTimeFromRange,
	getVerb,
	pageQueryParam,
	zodCollectionFilter,
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
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
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
	const cookieName = await getEnhancedCookieName(
		`media.${action}.${lot}`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const schema = z.object({
		query: z.string().optional(),
		[pageQueryParam]: zodIntAsString.default("1"),
	});
	const query = parseSearchQuery(request, schema);
	const [totalResults, mediaList, mediaSearch] = await match(action)
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
			const { userMetadataList } = await serverGqlService.authenticatedRequest(
				request,
				UserMetadataListDocument,
				{
					input: {
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
					},
				},
			);
			return [
				userMetadataList.response.details.total,
				{ list: userMetadataList, url: urlParse },
				undefined,
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
	const { isTourStarted, advanceTourStep } = useOnboardingTour();

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
		loaderData.lot === MediaLot.Movie && isTourStarted;

	return (
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
						if (v === "search" && isTourStarted) {
							advanceTourStep();
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
						className={OnboardingTourStepTargets.Two}
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
						/>
						{(loaderData.mediaList?.url.startDateRange ||
							loaderData.mediaList?.url.endDateRange) &&
						!coreDetails.isServerKeyValidated ? (
							<ProRequiredAlert alertText="Ryot Pro is required to filter by dates" />
						) : loaderData.mediaList.list.response.details.total > 0 ? (
							<ApplicationGrid className={OnboardingTourStepTargets.Ten}>
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
								tourControlTarget={
									isEligibleForNextTourStep
										? OnboardingTourStepTargets.Three
										: undefined
								}
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
											item={b}
											key={b.identifier}
											isFirstItem={index === 0}
											source={mediaSearch.url.source}
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
	);
}

const MediaSearchItem = (props: {
	source: MediaSource;
	isFirstItem: boolean;
	isEligibleForNextTourStep: boolean;
	item: MetadataSearchQuery["metadataSearch"]["items"][number];
}) => {
	const navigate = useNavigate();
	const loaderData = useLoaderData<typeof loader>();
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const [isLoading, setIsLoading] = useState(false);
	const revalidator = useRevalidator();
	const events = useApplicationEvents();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();
	const { advanceTourStep } = useOnboardingTour();

	const gridPacking = userPreferences.general.gridPacking;
	const buttonSize =
		gridPacking === GridPacking.Normal ? "compact-md" : "compact-xs";

	const tourControlOne = props.isFirstItem
		? {
				onTargetInteract: advanceTourStep,
				target: OnboardingTourStepTargets.Four,
			}
		: undefined;

	const tourControlTwo = props.isFirstItem
		? {
				onTargetInteract: advanceTourStep,
				target: OnboardingTourStepTargets.Five,
			}
		: undefined;

	const tourControlThree = props.isFirstItem
		? {
				onTargetInteract: advanceTourStep,
				target: OnboardingTourStepTargets.Seven,
			}
		: undefined;

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
				imageClassName={tourControlThree?.target}
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
					if (tourControlThree?.target) {
						tourControlThree.onTargetInteract();
					}
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
					className={tourControlTwo?.target}
					onClick={async () => {
						const metadataId = await basicCommit();
						setMetadataToUpdate({ metadataId });
						if (tourControlTwo?.target) {
							tourControlTwo.onTargetInteract();
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
					className={tourControlOne?.target}
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
						if (tourControlOne?.target) {
							tourControlOne.onTargetInteract();
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
