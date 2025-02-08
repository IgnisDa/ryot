import {
	ActionIcon,
	Box,
	Container,
	Group,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	CollectionContentsDocument,
	type CollectionContentsInput,
	EntityLot,
	FilterPresetContextType,
} from "@ryot/generated/graphql/backend/graphql";
import { cloneDeep } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconEdit,
	IconMessageCircle2,
	IconStar,
	IconUser,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import invariant from "tiny-invariant";
import { SkeletonLoader } from "~/components/common";
import { BulkCollectionEditingAffix } from "~/components/common/bulk-collection-editing-affix";
import { FilterPresetModalManager } from "~/components/common/filter-presets";
import { ActionsTabPanel } from "~/components/routes/collections/actions-tab-panel";
import { ContentsTabPanel } from "~/components/routes/collections/contents-tab-panel";
import { defaultQueryState } from "~/components/routes/collections/filters-state";
import { RecommendationsSection } from "~/components/routes/collections/recommendations-section";
import { ReviewsTabPanel } from "~/components/routes/collections/reviews-tab-panel";
import { useFilterPresets } from "~/lib/hooks/filters/use-presets";
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	useBulkEditCollection,
	useCreateOrUpdateCollectionModal,
} from "~/lib/state/collection";
import { useReviewEntity } from "~/lib/state/media";

enum TabNames {
	Actions = "actions",
	Reviews = "reviews",
	Contents = "contents",
	Recommendations = "recommendations",
}

const DEFAULT_TAB = TabNames.Contents;

export const meta = () => {
	return [{ title: "Collection Details | Ryot" }];
};

const nonEmpty = <T,>(arr: T[]) => (arr.length > 0 ? arr : undefined);

export default function Page(props: { params: { id: string } }) {
	const userDetails = useUserDetails();
	const { id: collectionId } = props.params;
	const userPreferences = useUserPreferences();
	const userCollections = useUserCollections();
	const [_r, setEntityToReview] = useReviewEntity();
	const bulkEditingCollection = useBulkEditCollection();
	const [isReorderMode, setIsReorderMode] = useState(false);
	const [tab, setTab] = useState<string | null>(DEFAULT_TAB);
	const { open: openCollectionModal } = useCreateOrUpdateCollectionModal();

	const { filters, resetFilters, updateFilters, haveFiltersChanged } =
		useFiltersState(defaultQueryState);

	const [
		presetModalOpened,
		{ open: openPresetModal, close: closePresetModal },
	] = useDisclosure(false);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	invariant(collectionId);

	const contentsPresets = useFilterPresets({
		filters,
		updateFilters,
		enabled: true,
		contextInformation: { collectionId },
		contextType: FilterPresetContextType.CollectionContents,
	});

	const queryInput: CollectionContentsInput = useMemo(() => {
		const isMetadataEntity = filters.entityLot === EntityLot.Metadata;
		const isExerciseEntity = filters.entityLot === EntityLot.Exercise;

		return {
			collectionId,
			sort: { by: filters.sortBy, order: filters.orderBy },
			search: { page: filters.page, query: filters.query },
			filter: {
				entityLot: filters.entityLot,
				collections: filters.collections,
				dateRange: {
					endDate: filters.endDateRange || undefined,
					startDate: filters.startDateRange || undefined,
				},
				metadata:
					isMetadataEntity &&
					(filters.metadataLot ||
						filters.metadataSource ||
						filters.metadataGeneral)
						? {
								lot: filters.metadataLot,
								source: filters.metadataSource,
								general: filters.metadataGeneral,
							}
						: undefined,
				exercise:
					isExerciseEntity &&
					(filters.exerciseTypes.length > 0 ||
						filters.exerciseLevels.length > 0 ||
						filters.exerciseForces.length > 0 ||
						filters.exerciseMuscles.length > 0 ||
						filters.exerciseMechanics.length > 0 ||
						filters.exerciseEquipments.length > 0)
						? {
								types: nonEmpty(filters.exerciseTypes),
								levels: nonEmpty(filters.exerciseLevels),
								forces: nonEmpty(filters.exerciseForces),
								muscles: nonEmpty(filters.exerciseMuscles),
								mechanics: nonEmpty(filters.exerciseMechanics),
								equipments: nonEmpty(filters.exerciseEquipments),
							}
						: undefined,
			},
		};
	}, [collectionId, filters]);

	const { data: collectionContents, refetch: refreshCollectionContents } =
		useQuery({
			queryKey:
				queryFactory.collections.collectionContents(queryInput).queryKey,
			queryFn: () =>
				clientGqlService
					.request(CollectionContentsDocument, { input: queryInput })
					.then((data) => data.collectionContents),
		});

	const details = collectionContents?.response;
	const colDetails = details
		? {
				id: collectionId,
				name: details.details.name,
				creatorUserId: details.user.id,
			}
		: null;
	const thisCollection = userCollections.find((c) => c.id === collectionId);

	return (
		<>
			<FilterPresetModalManager
				opened={presetModalOpened}
				onClose={closePresetModal}
				presetManager={contentsPresets}
				placeholder="e.g., Favorite Collection View"
			/>
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
									<ContentsTabPanel
										details={details}
										filters={filters}
										resetFilters={resetFilters}
										updateFilters={updateFilters}
										isReorderMode={isReorderMode}
										openPresetModal={openPresetModal}
										contentsPresets={contentsPresets}
										setIsReorderMode={setIsReorderMode}
										openFiltersModal={openFiltersModal}
										closeFiltersModal={closeFiltersModal}
										collectionContents={collectionContents}
										haveFiltersChanged={haveFiltersChanged}
										filtersModalOpened={filtersModalOpened}
										refreshCollectionContents={refreshCollectionContents}
									/>
								</Tabs.Panel>
								<Tabs.Panel value={TabNames.Recommendations}>
									<RecommendationsSection collectionId={collectionId} />
								</Tabs.Panel>
								<Tabs.Panel value={TabNames.Actions}>
									<ActionsTabPanel
										setTab={setTab}
										details={details}
										colDetails={colDetails}
										collectionId={collectionId}
										resetFilters={resetFilters}
										updateFilters={updateFilters}
										isReorderMode={isReorderMode}
										setIsReorderMode={setIsReorderMode}
										contentsTabValue={TabNames.Contents}
										setEntityToReview={setEntityToReview}
										bulkEditingCollection={bulkEditingCollection}
									/>
								</Tabs.Panel>
								{!userPreferences.general.disableReviews ? (
									<Tabs.Panel value={TabNames.Reviews}>
										<ReviewsTabPanel
											details={details}
											collectionId={collectionId}
										/>
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
