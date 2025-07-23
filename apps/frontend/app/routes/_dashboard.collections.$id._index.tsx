import {
	ActionIcon,
	Box,
	Button,
	Center,
	Container,
	Flex,
	Group,
	Pagination,
	Select,
	SimpleGrid,
	Skeleton,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
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
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	cloneDeep,
	parseParameters,
	parseSearchQuery,
	zodIntAsString,
} from "@ryot/ts-utils";
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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
	BulkCollectionEditingAffix,
	DisplayCollectionEntity,
	DisplayListDetailsAndRefresh,
} from "~/components/common";
import {
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { ReviewItemDisplay } from "~/components/common/review";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { pageQueryParam } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useAppSearchParam,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/query-factory";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import {
	useBulkEditCollection,
	useCreateOrUpdateCollectionModal,
} from "~/lib/state/collection";
import { useReviewEntity } from "~/lib/state/media";
import {
	getSearchEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.collections.$id._index";

const DEFAULT_TAB = "contents";

const defaultFiltersValue = {
	order: GraphqlSortOrder.Desc,
	sort: CollectionContentsSortBy.Rank,
};

const searchParamsSchema = z.object({
	query: z.string().optional(),
	defaultTab: z.string().optional(),
	[pageQueryParam]: zodIntAsString.optional(),
	entityLot: z.enum(EntityLot).optional(),
	metadataLot: z.enum(MediaLot).optional(),
	orderBy: z.enum(GraphqlSortOrder).default(defaultFiltersValue.order),
	sortBy: z.enum(CollectionContentsSortBy).default(defaultFiltersValue.sort),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { id: collectionId } = parseParameters(
		params,
		z.object({ id: z.string() }),
	);
	const cookieName = await getSearchEnhancedCookieName(
		`collections.details.${collectionId}`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	const input: CollectionContentsInput = {
		collectionId,
		sort: { by: query.sortBy, order: query.orderBy },
		search: { page: query[pageQueryParam], query: query.query },
		filter: { entityLot: query.entityLot, metadataLot: query.metadataLot },
	};
	const [{ collectionContents }, { usersList }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, CollectionContentsDocument, {
			input,
		}),
		serverGqlService.authenticatedRequest(request, UsersListDocument, {}),
	]);
	const totalPages = await redirectToFirstPageIfOnInvalidPage({
		request,
		currentPage: query[pageQueryParam] || 1,
		totalResults: collectionContents.response.results.details.total,
	});
	return {
		query,
		cookieName,
		totalPages,
		collectionId,
		queryInput: input,
		collectionContents,
		usersList,
	};
};

export const meta = ({ data }: Route.MetaArgs) => {
	return [
		{ title: `${data?.collectionContents.response.details.name} | Ryot` },
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const userDetails = useUserDetails();
	const navigate = useNavigate();
	const userCollections = useUserCollections();

	const { open: openCollectionModal } = useCreateOrUpdateCollectionModal();
	const [tab, setTab] = useState<string | null>(
		loaderData.query.defaultTab || DEFAULT_TAB,
	);
	const [_e, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [_r, setEntityToReview] = useReviewEntity();
	const bulkEditingCollection = useBulkEditCollection();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const details = loaderData.collectionContents.response;
	const colDetails = {
		name: details.details.name,
		id: loaderData.collectionId,
		creatorUserId: details.user.id,
	};
	const thisCollection = userCollections.find(
		(c) => c.id === loaderData.collectionId,
	);

	return (
		<>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					const input = cloneDeep(loaderData.queryInput);
					input.search = { ...input.search, take: Number.MAX_SAFE_INTEGER };
					return await clientGqlService
						.request(CollectionContentsDocument, { input })
						.then((r) => r.collectionContents.response.results.items);
				}}
			/>
			<Container>
				<Stack>
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
											openCollectionModal(
												{ collectionId: thisCollection.id },
												loaderData.usersList,
											);
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
								value="contents"
								leftSection={<IconBucketDroplet size={16} />}
							>
								Contents
							</Tabs.Tab>
							<Tabs.Tab
								value="recommendations"
								leftSection={<IconStar size={16} />}
							>
								Recommendations
							</Tabs.Tab>
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
							{!userPreferences.general.disableReviews ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : null}
						</Tabs.List>
						<Tabs.Panel value="contents">
							<Stack gap="xs">
								<Group wrap="nowrap">
									<DebouncedSearchInput
										initialValue={loaderData.query.query}
										placeholder="Search in the collection"
										enhancedQueryParams={loaderData.cookieName}
									/>
									<ActionIcon
										onClick={() => openFiltersModal()}
										color={
											loaderData.query.entityLot !== undefined ||
											loaderData.query.metadataLot !== undefined ||
											loaderData.query.sortBy !== defaultFiltersValue.sort ||
											loaderData.query.orderBy !== defaultFiltersValue.order
												? "blue"
												: "gray"
										}
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
									total={details.totalItems}
									cacheId={loaderData.collectionContents.cacheId}
									isRandomSortOrderSelected={
										loaderData.query.sortBy === CollectionContentsSortBy.Random
									}
								/>
								{details.results.items.length > 0 ? (
									<ApplicationGrid>
										{details.results.items.map((lm) => (
											<CollectionItem key={lm.entityId} item={lm} />
										))}
									</ApplicationGrid>
								) : (
									<Text>You have not added anything this collection</Text>
								)}
								{details.details ? (
									<Center>
										<Pagination
											size="sm"
											total={loaderData.totalPages}
											value={loaderData.query[pageQueryParam]}
											onChange={(v) => setP(pageQueryParam, v.toString())}
										/>
									</Center>
								) : null}
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="recommendations">
							<RecommendationsSection />
						</Tabs.Panel>
						<Tabs.Panel value="actions">
							<SimpleGrid cols={{ base: 2, md: 3, lg: 4 }} spacing="lg">
								<Button
									variant="outline"
									w="100%"
									onClick={() => {
										setEntityToReview({
											entityLot: EntityLot.Collection,
											entityId: loaderData.collectionId,
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
									disabled={details.results.details.total === 0}
									onClick={() => {
										bulkEditingCollection.start(colDetails, "remove");
										setTab("contents");
									}}
								>
									Bulk remove
								</Button>
							</SimpleGrid>
						</Tabs.Panel>
						{!userPreferences.general.disableReviews ? (
							<Tabs.Panel value="reviews">
								{details.reviews.length > 0 ? (
									<Stack>
										{details.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												entityLot={EntityLot.Collection}
												entityId={loaderData.collectionId}
												title={details.details.name}
											/>
										))}
									</Stack>
								) : (
									<Text>No reviews</Text>
								)}
							</Tabs.Panel>
						) : null}
					</Tabs>
				</Stack>
			</Container>
		</>
	);
}

const FiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					data={[
						{
							group: "Sort by",
							items: convertEnumToSelectData(CollectionContentsSortBy),
						},
					]}
					defaultValue={loaderData.query.sortBy}
					onChange={(v) => setP("sortBy", v)}
				/>
				<ActionIcon
					onClick={() => {
						if (loaderData.query.orderBy === GraphqlSortOrder.Asc)
							setP("orderBy", GraphqlSortOrder.Desc);
						else setP("orderBy", GraphqlSortOrder.Asc);
					}}
				>
					{loaderData.query.orderBy === GraphqlSortOrder.Asc ? (
						<IconSortAscending />
					) : (
						<IconSortDescending />
					)}
				</ActionIcon>
			</Flex>
			<Select
				clearable
				placeholder="Select an entity type"
				defaultValue={loaderData.query.entityLot}
				onChange={(v) => setP("entityLot", v)}
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
			{loaderData.query.entityLot === EntityLot.Metadata ||
			loaderData.query.entityLot === EntityLot.MetadataGroup ? (
				<Select
					clearable
					placeholder="Select a media type"
					defaultValue={loaderData.query.metadataLot}
					onChange={(v) => setP("metadataLot", v)}
					data={convertEnumToSelectData(MediaLot)}
				/>
			) : null}
		</>
	);
};

const RecommendationsSection = () => {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();

	const [searchInput, setSearchInput] = useLocalStorage(
		"CollectionRecommendationsSearchInput",
		{ page: 1, query: "" },
	);

	const input: CollectionRecommendationsInput = {
		collectionId: loaderData.collectionId,
		search: searchInput,
	};

	const recommendations = useQuery({
		queryKey: queryFactory.collections.recommendations(input).queryKey,
		queryFn: () =>
			clientGqlService.request(CollectionRecommendationsDocument, { input }),
	});

	return (
		<Stack gap="xs">
			<DebouncedSearchInput
				initialValue={searchInput.query}
				onChange={(query) => setSearchInput({ ...searchInput, query })}
			/>
			{recommendations.data ? (
				recommendations.data.collectionRecommendations.details.total > 0 ? (
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
						<Center>
							<Pagination
								size="sm"
								value={searchInput.page}
								onChange={(v) => setSearchInput({ ...searchInput, page: v })}
								total={Math.ceil(
									recommendations.data.collectionRecommendations.details.total /
										userPreferences.general.listPageSize,
								)}
							/>
						</Center>
					</>
				) : (
					<Text>No recommendations found</Text>
				)
			) : (
				<Skeleton height={100} />
			)}
		</Stack>
	);
};

const CollectionItem = ({ item }: { item: EntityWithLot }) => {
	const bulkEditingCollection = useBulkEditCollection();
	const state = bulkEditingCollection.state;
	const isAdded = bulkEditingCollection.isAdded(item);

	return (
		<DisplayCollectionEntity
			entityId={item.entityId}
			entityLot={item.entityLot}
			topRight={
				state && state.data.action === "remove" ? (
					<ActionIcon
						variant={isAdded ? "filled" : "transparent"}
						color="red"
						onClick={() => {
							if (isAdded) state.remove(item);
							else state.add(item);
						}}
					>
						<IconTrashFilled size={18} />
					</ActionIcon>
				) : null
			}
		/>
	);
};
