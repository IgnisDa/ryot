import {
	ActionIcon,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CollectionContentsDocument,
	type CollectionContentsInput,
	CollectionContentsSortBy,
	CollectionRecommendationsDocument,
	type CollectionRecommendationsInput,
	EntityLot,
	type EntityWithLot,
	GraphqlSortOrder,
	MediaLot,
	ReorderCollectionEntityDocument,
	type ReorderCollectionEntityInput,
} from "@ryot/generated/graphql/backend/graphql";
import { cloneDeep, isNumber } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconEdit,
	IconFilter,
	IconMessageCircle2,
	IconSortAscending,
	IconSortDescending,
	IconStar,
	IconTrashFilled,
	IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationPagination,
	DisplayCollectionEntity,
	DisplayListDetailsAndRefresh,
	SkeletonLoader,
} from "~/components/common";
import { BulkCollectionEditingAffix } from "~/components/common/BulkCollectionEditingAffix";
import {
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { ReviewItemDisplay } from "~/components/common/review";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	isFilterChanged,
} from "~/lib/shared/ui-utils";
import {
	useBulkEditCollection,
	useCreateOrUpdateCollectionModal,
} from "~/lib/state/collection";
import { useReviewEntity } from "~/lib/state/media";
import type { FilterUpdateFunction } from "~/lib/types";

enum TabNames {
	Actions = "actions",
	Reviews = "reviews",
	Contents = "contents",
	Recommendations = "recommendations",
}

const DEFAULT_TAB = TabNames.Contents;

interface FilterState {
	page: number;
	query: string;
	entityLot?: EntityLot;
	metadataLot?: MediaLot;
	orderBy: GraphqlSortOrder;
	sortBy: CollectionContentsSortBy;
}

const defaultFilters: FilterState = {
	page: 1,
	query: "",
	entityLot: undefined,
	metadataLot: undefined,
	orderBy: GraphqlSortOrder.Desc,
	sortBy: CollectionContentsSortBy.LastUpdatedOn,
};

export const meta = () => {
	return [{ title: "Collection Details | Ryot" }];
};

export default function Page(props: { params: { id: string } }) {
	const navigate = useNavigate();
	const userDetails = useUserDetails();
	const coreDetails = useCoreDetails();
	const { id: collectionId } = props.params;
	const userPreferences = useUserPreferences();
	const userCollections = useUserCollections();
	const [_r, setEntityToReview] = useReviewEntity();
	const bulkEditingCollection = useBulkEditCollection();
	const [isReorderMode, setIsReorderMode] = useState(false);
	const [tab, setTab] = useState<string | null>(DEFAULT_TAB);
	const { open: openCollectionModal } = useCreateOrUpdateCollectionModal();
	const [filters, setFilters] = useLocalStorage(
		`CollectionFilters-${collectionId}`,
		defaultFilters,
	);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	invariant(collectionId);

	const queryInput: CollectionContentsInput = {
		collectionId,
		sort: { by: filters.sortBy, order: filters.orderBy },
		search: { page: filters.page, query: filters.query },
		filter: { entityLot: filters.entityLot, metadataLot: filters.metadataLot },
	};

	const { data: collectionContents, refetch: refreshCollectionContents } =
		useQuery({
			queryKey:
				queryFactory.collections.collectionContents(queryInput).queryKey,
			queryFn: () =>
				clientGqlService
					.request(CollectionContentsDocument, { input: queryInput })
					.then((data) => data.collectionContents),
		});

	const updateFilter: FilterUpdateFunction<FilterState> = (key, value) =>
		setFilters((prev) => ({ ...prev, [key]: value }));

	const details = collectionContents?.response;
	const colDetails = details && {
		id: collectionId,
		name: details.details.name,
		creatorUserId: details.user.id,
	};
	const thisCollection = userCollections.find((c) => c.id === collectionId);
	const areListFiltersActive = isFilterChanged(filters, defaultFilters);

	return (
		<>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					const input = cloneDeep(queryInput);
					input.search = { ...input.search, take: Number.MAX_SAFE_INTEGER };
					return await clientGqlService
						.request(CollectionContentsDocument, { input })
						.then((r) => r.collectionContents.response.results.items);
				}}
			/>
			<Container>
				<Stack>
					{details ? (
						<>
							<Group justify="space-between" align="flex-start">
								<Box>
									<Group gap="md">
										<Title>{details.details.name}</Title>
										{userDetails.id === details.user.id ? (
											<ActionIcon
												color="blue"
												variant="outline"
												onClick={() => {
													if (!thisCollection) return;
													openCollectionModal({
														collectionId: thisCollection.id,
													});
												}}
											>
												<IconEdit size={18} />
											</ActionIcon>
										) : null}
									</Group>
									<Text size="sm">
										Created by {details.user.name}{" "}
										{dayjsLib(details.details.createdOn).fromNow()}
									</Text>
								</Box>
							</Group>
							<Text>{details.details.description}</Text>
							<Tabs value={tab} onChange={setTab} keepMounted={false}>
								<Tabs.List mb="xs">
									<Tabs.Tab
										value={TabNames.Contents}
										leftSection={<IconBucketDroplet size={16} />}
									>
										Contents
									</Tabs.Tab>
									<Tabs.Tab
										value={TabNames.Recommendations}
										leftSection={<IconStar size={16} />}
									>
										Recommendations
									</Tabs.Tab>
									<Tabs.Tab
										value={TabNames.Actions}
										leftSection={<IconUser size={16} />}
									>
										Actions
									</Tabs.Tab>
									{!userPreferences.general.disableReviews ? (
										<Tabs.Tab
											value={TabNames.Reviews}
											leftSection={<IconMessageCircle2 size={16} />}
										>
											Reviews
										</Tabs.Tab>
									) : null}
								</Tabs.List>
								<Tabs.Panel value={TabNames.Contents}>
									<Stack gap="xs">
										{!isReorderMode ? (
											<>
												<Group wrap="nowrap">
													<DebouncedSearchInput
														value={filters.query}
														placeholder="Search in the collection"
														onChange={(value) => {
															updateFilter("query", value);
															updateFilter("page", 1);
														}}
													/>
													<ActionIcon
														onClick={() => openFiltersModal()}
														color={areListFiltersActive ? "blue" : "gray"}
													>
														<IconFilter size={24} />
													</ActionIcon>
													<FiltersModal
														opened={filtersModalOpened}
														closeFiltersModal={closeFiltersModal}
														resetFilters={() => setFilters(defaultFilters)}
													>
														<FiltersModalForm
															filters={filters}
															updateFilter={updateFilter}
														/>
													</FiltersModal>
												</Group>
												<DisplayListDetailsAndRefresh
													total={details.totalItems}
													cacheId={collectionContents?.cacheId}
													onRefreshButtonClicked={refreshCollectionContents}
													isRandomSortOrderSelected={
														filters.sortBy === CollectionContentsSortBy.Random
													}
												/>
											</>
										) : (
											<Group justify="end">
												<Button
													variant="outline"
													onClick={() => setIsReorderMode(false)}
												>
													Done Reordering
												</Button>
											</Group>
										)}
										{details.results.items.length > 0 ? (
											<ApplicationGrid>
												{details.results.items.map((lm, index) => (
													<CollectionItem
														item={lm}
														key={lm.entityId}
														rankNumber={index + 1}
														isReorderMode={isReorderMode}
														collectionName={details.details.name}
														totalItems={details.results.items.length}
													/>
												))}
											</ApplicationGrid>
										) : (
											<Text>
												You have not added anything to this collection
											</Text>
										)}
										<ApplicationPagination
											value={filters.page}
											onChange={(v) => updateFilter("page", v)}
											totalItems={details.results.details.totalItems}
										/>
									</Stack>
								</Tabs.Panel>
								<Tabs.Panel value={TabNames.Recommendations}>
									<RecommendationsSection collectionId={collectionId} />
								</Tabs.Panel>
								<Tabs.Panel value={TabNames.Actions}>
									<SimpleGrid cols={{ base: 2, md: 3, lg: 4 }} spacing="lg">
										<Button
											variant="outline"
											w="100%"
											onClick={() => {
												setEntityToReview({
													entityId: collectionId,
													entityLot: EntityLot.Collection,
													entityTitle: details.details.name,
												});
											}}
										>
											Post a review
										</Button>
										<Button
											w="100%"
											variant="outline"
											onClick={() => {
												if (!colDetails) return;
												bulkEditingCollection.start(colDetails, "add");
												navigate(
													$path("/media/:action/:lot", {
														action: "list",
														lot: MediaLot.Movie,
													}),
												);
											}}
										>
											Bulk add
										</Button>
										<Button
											w="100%"
											variant="outline"
											disabled={details.results.details.totalItems === 0}
											onClick={() => {
												if (!colDetails) return;
												bulkEditingCollection.start(colDetails, "remove");
												setTab(TabNames.Contents);
											}}
										>
											Bulk remove
										</Button>
										<Button
											w="100%"
											variant="outline"
											disabled={details.results.details.totalItems === 0}
											onClick={() => {
												if (isReorderMode) {
													setIsReorderMode(false);
													return;
												}
												if (!coreDetails.isServerKeyValidated) {
													notifications.show({
														color: "red",
														title: "Pro Required",
														message:
															"Collection reordering requires a validated server key.",
													});
													return;
												}
												setFilters({
													...defaultFilters,
													orderBy: GraphqlSortOrder.Asc,
													sortBy: CollectionContentsSortBy.Rank,
												});
												setTab(TabNames.Contents);
												setIsReorderMode(true);
											}}
										>
											{isReorderMode ? "Exit Reorder Mode" : "Reorder items"}
										</Button>
									</SimpleGrid>
								</Tabs.Panel>
								{!userPreferences.general.disableReviews ? (
									<Tabs.Panel value={TabNames.Reviews}>
										{details.reviews.length > 0 ? (
											<Stack>
												{details.reviews.map((r) => (
													<ReviewItemDisplay
														review={r}
														key={r.id}
														entityId={collectionId}
														title={details.details.name}
														entityLot={EntityLot.Collection}
													/>
												))}
											</Stack>
										) : (
											<Text>No reviews</Text>
										)}
									</Tabs.Panel>
								) : null}
							</Tabs>
						</>
					) : (
						<SkeletonLoader />
					)}
				</Stack>
			</Container>
		</>
	);
}

const FiltersModalForm = (props: {
	filters: FilterState;
	updateFilter: FilterUpdateFunction<FilterState>;
}) => {
	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					defaultValue={props.filters.sortBy}
					onChange={(v) =>
						props.updateFilter("sortBy", v as CollectionContentsSortBy)
					}
					data={[
						{
							group: "Sort by",
							items: convertEnumToSelectData(CollectionContentsSortBy),
						},
					]}
				/>
				<ActionIcon
					onClick={() => {
						if (props.filters.orderBy === GraphqlSortOrder.Asc)
							props.updateFilter("orderBy", GraphqlSortOrder.Desc);
						else props.updateFilter("orderBy", GraphqlSortOrder.Asc);
					}}
				>
					{props.filters.orderBy === GraphqlSortOrder.Asc ? (
						<IconSortAscending />
					) : (
						<IconSortDescending />
					)}
				</ActionIcon>
			</Flex>
			<Select
				clearable
				placeholder="Select an entity type"
				defaultValue={props.filters.entityLot}
				onChange={(v) => props.updateFilter("entityLot", v as EntityLot)}
				data={convertEnumToSelectData(
					Object.values(EntityLot).filter(
						(o) =>
							![
								EntityLot.Collection,
								EntityLot.Review,
								EntityLot.UserMeasurement,
							].includes(o),
					),
				)}
			/>
			{props.filters.entityLot === EntityLot.Metadata ||
			props.filters.entityLot === EntityLot.MetadataGroup ? (
				<Select
					clearable
					placeholder="Select a media type"
					defaultValue={props.filters.metadataLot}
					data={convertEnumToSelectData(MediaLot)}
					onChange={(v) => props.updateFilter("metadataLot", v as MediaLot)}
				/>
			) : null}
		</>
	);
};

const RecommendationsSection = ({ collectionId }: { collectionId: string }) => {
	const [search, setSearchInput] = useLocalStorage(
		"CollectionRecommendationsSearchInput",
		{ page: 1, query: "" },
	);

	const input: CollectionRecommendationsInput = { collectionId, search };

	const recommendations = useQuery({
		queryKey:
			queryFactory.collections.collectionRecommendations(input).queryKey,
		queryFn: () =>
			clientGqlService.request(CollectionRecommendationsDocument, { input }),
	});

	return (
		<Stack gap="xs">
			<DebouncedSearchInput
				value={search.query}
				placeholder="Search recommendations"
				onChange={(query) => setSearchInput({ ...search, query })}
			/>
			{recommendations.data ? (
				recommendations.data.collectionRecommendations.details.totalItems >
				0 ? (
					<>
						<ApplicationGrid>
							{recommendations.data.collectionRecommendations.items.map((r) => (
								<MetadataDisplayItem
									key={r}
									metadataId={r}
									shouldHighlightNameIfInteracted
								/>
							))}
						</ApplicationGrid>
						<ApplicationPagination
							value={search.page}
							onChange={(v) => setSearchInput({ ...search, page: v })}
							totalItems={
								recommendations.data.collectionRecommendations.details
									.totalItems
							}
						/>
					</>
				) : (
					<Text>No recommendations found</Text>
				)
			) : (
				<SkeletonLoader />
			)}
		</Stack>
	);
};

type CollectionItemProps = {
	rankNumber: number;
	totalItems: number;
	item: EntityWithLot;
	collectionName: string;
	isReorderMode: boolean;
};

const CollectionItem = (props: CollectionItemProps) => {
	const bulkEditingCollection = useBulkEditCollection();
	const state = bulkEditingCollection.state;
	const isAdded = bulkEditingCollection.isAdded(props.item);

	const reorderMutation = useMutation({
		mutationFn: (input: ReorderCollectionEntityInput) =>
			clientGqlService.request(ReorderCollectionEntityDocument, { input }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryFactory.collections.collectionContents._def,
			});
		},
		onError: (_error) => {
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to reorder item. Please try again.",
			});
		},
	});

	const handleRankClick = () => {
		if (!props.isReorderMode) return;

		const newRank = prompt(
			`Enter new rank for this item (1-${props.totalItems}):`,
		);
		const rank = Number(newRank);
		if (newRank && isNumber(rank)) {
			if (rank >= 1 && rank <= props.totalItems) {
				reorderMutation.mutate({
					newPosition: rank,
					entityId: props.item.entityId,
					collectionName: props.collectionName,
				});
			}
		}
	};

	return (
		<DisplayCollectionEntity
			entityId={props.item.entityId}
			entityLot={props.item.entityLot}
			topLeft={
				props.isReorderMode ? (
					<ActionIcon variant="filled" onClick={handleRankClick}>
						<Text size="xs" fw={700} c="white">
							{props.rankNumber}
						</Text>
					</ActionIcon>
				) : null
			}
			topRight={
				state && state.data.action === "remove" ? (
					<ActionIcon
						color="red"
						variant={isAdded ? "filled" : "transparent"}
						onClick={() => {
							if (isAdded) state.remove(props.item);
							else state.add(props.item);
						}}
					>
						<IconTrashFilled size={18} />
					</ActionIcon>
				) : null
			}
		/>
	);
};
