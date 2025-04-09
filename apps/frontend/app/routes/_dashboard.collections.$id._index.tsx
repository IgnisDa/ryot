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
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	CollectionRecommendationsDocument,
	EntityLot,
	GraphqlSortOrder,
	MediaLot,
} from "@ryot/generated/graphql/backend/graphql";
import {
	parseParameters,
	parseSearchQuery,
	startCase,
	zodIntAsString,
} from "@ryot/ts-utils";
import {
	IconBucketDroplet,
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
import { z } from "zod";
import {
	ApplicationGrid,
	DebouncedSearchInput,
	DisplayCollectionEntity,
	DisplayListDetailsAndRefresh,
	FiltersModal,
	ReviewItemDisplay,
} from "~/components/common";
import {
	clientGqlService,
	dayjsLib,
	pageQueryParam,
	queryFactory,
} from "~/lib/common";
import { useAppSearchParam, useUserPreferences } from "~/lib/hooks";
import { useBulkEditCollection } from "~/lib/state/collection";
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
	sort: CollectionContentsSortBy.LastUpdatedOn,
	order: GraphqlSortOrder.Desc,
};

const searchParamsSchema = z.object({
	query: z.string().optional(),
	defaultTab: z.string().optional(),
	[pageQueryParam]: zodIntAsString.optional(),
	entityLot: z.nativeEnum(EntityLot).optional(),
	metadataLot: z.nativeEnum(MediaLot).optional(),
	orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFiltersValue.order),
	sortBy: z
		.nativeEnum(CollectionContentsSortBy)
		.default(defaultFiltersValue.sort),
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
	const [{ collectionContents }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, CollectionContentsDocument, {
			input: {
				collectionId,
				sort: { by: query.sortBy, order: query.orderBy },
				search: { page: query[pageQueryParam], query: query.query },
				filter: { entityLot: query.entityLot, metadataLot: query.metadataLot },
			},
		}),
	]);
	const totalPages = await redirectToFirstPageIfOnInvalidPage({
		request,
		currentPage: query[pageQueryParam] || 1,
		totalResults: collectionContents.response.results.details.total,
	});
	return { collectionId, query, collectionContents, cookieName, totalPages };
};

export const meta = ({ data }: Route.MetaArgs) => {
	return [
		{ title: `${data?.collectionContents.response.details.name} | Ryot` },
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const navigate = useNavigate();
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
	const state = bulkEditingCollection.state;

	return (
		<Container>
			<Stack>
				<Box>
					<Title>{details.details.name}</Title>
					<Text size="sm">
						{details.totalItems} items, created by {details.user.name}{" "}
						{dayjsLib(details.details.createdOn).fromNow()}
					</Text>
				</Box>
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
									closeFiltersModal={closeFiltersModal}
									cookieName={loaderData.cookieName}
									opened={filtersModalOpened}
								>
									<FiltersModalForm />
								</FiltersModal>
							</Group>
							<DisplayListDetailsAndRefresh
								total={details.results.details.total}
								cacheId={loaderData.collectionContents.cacheId}
							/>
							{details.results.items.length > 0 ? (
								<ApplicationGrid>
									{details.results.items.map((lm) => {
										const isAdded = bulkEditingCollection.isAdded(lm);
										return (
											<DisplayCollectionEntity
												key={lm.entityId}
												entityId={lm.entityId}
												entityLot={lm.entityLot}
												topRight={
													state && state.data.action === "remove" ? (
														<ActionIcon
															variant={isAdded ? "filled" : "transparent"}
															color="red"
															onClick={() => {
																if (isAdded) state.remove(lm);
																else state.add(lm);
															}}
														>
															<IconTrashFilled size={18} />
														</ActionIcon>
													) : null
												}
											/>
										);
									})}
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
							items: Object.values(CollectionContentsSortBy).map((o) => ({
								value: o.toString(),
								label: startCase(o.toLowerCase()),
							})),
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
				placeholder="Select an entity type"
				defaultValue={loaderData.query.entityLot}
				data={Object.values(EntityLot)
					.filter(
						(o) =>
							![
								EntityLot.Collection,
								EntityLot.Review,
								EntityLot.UserMeasurement,
							].includes(o),
					)
					.map((o) => ({
						value: o.toString(),
						label: startCase(o.toLowerCase()),
					}))}
				onChange={(v) => setP("entityLot", v)}
				clearable
			/>
			{loaderData.query.entityLot === EntityLot.Metadata ||
			loaderData.query.entityLot === EntityLot.MetadataGroup ? (
				<Select
					placeholder="Select a media type"
					defaultValue={loaderData.query.metadataLot}
					data={Object.values(MediaLot).map((o) => ({
						value: o.toString(),
						label: startCase(o.toLowerCase()),
					}))}
					onChange={(v) => setP("metadataLot", v)}
					clearable
				/>
			) : null}
		</>
	);
};

const RecommendationsSection = () => {
	const loaderData = useLoaderData<typeof loader>();

	const [searchInput, setSearchInput] = useState({ page: 1, query: "" });

	const recommendations = useQuery({
		queryKey: queryFactory.collections.recommendations(
			loaderData.collectionId,
			searchInput,
		).queryKey,
		queryFn: () =>
			clientGqlService.request(CollectionRecommendationsDocument, {
				input: { collectionId: loaderData.collectionId, search: searchInput },
			}),
	});

	return (
		<Stack gap="xs">
			<DebouncedSearchInput
				initialValue={searchInput.query}
				onChange={(query) => setSearchInput({ ...searchInput, query })}
			/>
			{JSON.stringify(recommendations.data, null, 4)}
			{JSON.stringify(searchInput, null, 4)}
		</Stack>
	);
};
