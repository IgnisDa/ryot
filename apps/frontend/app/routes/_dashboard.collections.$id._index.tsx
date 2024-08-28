import {
	ActionIcon,
	Affix,
	Box,
	Button,
	Center,
	Container,
	Flex,
	Group,
	Pagination,
	Paper,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
	rem,
} from "@mantine/core";
import { useDisclosure, useListState } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	EntityLot,
	GraphqlSortOrder,
	MediaLot,
	RemoveEntityFromCollectionDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { processSubmission, startCase } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconFilter,
	IconMessageCircle2,
	IconSortAscending,
	IconSortDescending,
	IconTrashFilled,
	IconUser,
} from "@tabler/icons-react";
import { Fragment, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common";
import { DisplayCollectionEntity, ReviewItemDisplay } from "~/components/media";
import {
	clientGqlService,
	dayjsLib,
	queryClient,
	queryFactory,
} from "~/lib/generals";
import {
	useAppSearchParam,
	useCoreDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useReviewEntity } from "~/lib/state/media";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	removeCachedUserCollectionsList,
	serverGqlService,
} from "~/lib/utilities.server";

const DEFAULT_TAB = "contents";

const defaultFiltersValue = {
	sort: CollectionContentsSortBy.LastUpdatedOn,
	order: GraphqlSortOrder.Desc,
};

const searchParamsSchema = z.object({
	defaultTab: z.string().optional(),
	page: zx.IntAsString.optional(),
	query: z.string().optional(),
	sortBy: z
		.nativeEnum(CollectionContentsSortBy)
		.default(defaultFiltersValue.sort),
	orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFiltersValue.order),
	entityLot: z.nativeEnum(EntityLot).optional(),
	metadataLot: z.nativeEnum(MediaLot).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { id: collectionId } = zx.parseParams(params, { id: z.string() });
	const cookieName = await getEnhancedCookieName(
		`collections.details.${collectionId}`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ collectionContents }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, CollectionContentsDocument, {
			input: {
				collectionId,
				filter: {
					entityType: query.entityLot,
					metadataLot: query.metadataLot,
				},
				sort: { by: query.sortBy, order: query.orderBy },
				search: { page: query.page, query: query.query },
			},
		}),
	]);
	return { collectionId, query, collectionContents, cookieName };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.collectionContents.details.name} | Ryot` }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		bulkRemove: async () => {
			const submission = processSubmission(formData, bulkRemoveSchema);
			for (const item of submission.items) {
				await serverGqlService.authenticatedRequest(
					request,
					RemoveEntityFromCollectionDocument,
					{
						input: {
							...item,
							collectionName: submission.collectionName,
							creatorUserId: submission.creatorUserId,
						},
					},
				);
			}
			await removeCachedUserCollectionsList(request);
			return Response.json({});
		},
	});
});

const bulkRemoveSchema = z.object({
	collectionName: z.string(),
	creatorUserId: z.string(),
	items: z.array(
		z.object({
			entityId: z.string(),
			entityLot: z.nativeEnum(EntityLot),
		}),
	),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const coreDetails = useCoreDetails();
	const [tab, setTab] = useState<string | null>(
		loaderData.query.defaultTab || DEFAULT_TAB,
	);
	const [isBulkRemoving, setIsBulkRemoving] = useState(false);
	const [isSelectAllLoading, setIsSelectAllLoading] = useState(false);
	const [_e, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [_r, setEntityToReview] = useReviewEntity();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [bulkRemoveItems, bulkRemoveItemsHandler] = useListState<{
		entityId: string;
		entityLot: EntityLot;
	}>([]);

	const addBulkRemoveItem = (entityId: string, entityLot: EntityLot) => {
		if (!bulkRemoveItems.includes({ entityId, entityLot }))
			bulkRemoveItemsHandler.append({ entityId, entityLot });
	};

	return (
		<Container>
			{isBulkRemoving ? (
				<Affix position={{ bottom: rem(30) }} w="100%" px="sm">
					<Form
						method="POST"
						reloadDocument
						action={withQuery(".", { intent: "bulkRemove" })}
					>
						<input
							type="hidden"
							name="collectionName"
							defaultValue={loaderData.collectionContents.details.name}
						/>
						<input
							type="hidden"
							name="creatorUserId"
							defaultValue={loaderData.collectionContents.user.id}
						/>
						{bulkRemoveItems.map((item, index) => (
							<Fragment key={item.entityId}>
								<input
									type="hidden"
									readOnly
									name={`items[${index}].entityId`}
									value={item.entityId}
								/>
								<input
									type="hidden"
									readOnly
									name={`items[${index}].entityLot`}
									value={item.entityLot}
								/>
							</Fragment>
						))}
						<Paper withBorder shadow="xl" p="md" w={{ md: "40%" }} mx="auto">
							<Group wrap="nowrap" justify="space-between">
								<Text>{bulkRemoveItems.length} items selected</Text>
								<Group wrap="nowrap">
									<Button
										color="blue"
										loading={isSelectAllLoading}
										onClick={async () => {
											setIsSelectAllLoading(true);
											const { collectionContents } =
												await queryClient.ensureQueryData({
													queryKey: queryFactory.collections.details(
														loaderData.collectionId,
														Number.MAX_SAFE_INTEGER,
													).queryKey,
													queryFn: () =>
														clientGqlService.request(
															CollectionContentsDocument,
															{
																input: {
																	collectionId: loaderData.collectionId,
																	take: Number.MAX_SAFE_INTEGER,
																},
															},
														),
												});
											for (const lm of collectionContents.results.items)
												addBulkRemoveItem(lm.entityId, lm.entityLot);
											setIsSelectAllLoading(false);
										}}
									>
										Select all items
									</Button>
									<Button
										color="red"
										type="submit"
										disabled={bulkRemoveItems.length === 0}
									>
										Remove
									</Button>
								</Group>
							</Group>
						</Paper>
					</Form>
				</Affix>
			) : null}
			<Stack>
				<Box>
					<Title>{loaderData.collectionContents.details.name}</Title>{" "}
					<Text size="sm">
						{loaderData.collectionContents.results.details.total} items, created
						by {loaderData.collectionContents.user.name}{" "}
						{dayjsLib(
							loaderData.collectionContents.details.createdOn,
						).fromNow()}
					</Text>
				</Box>
				<Text>{loaderData.collectionContents.details.description}</Text>
				<Tabs value={tab} onChange={setTab}>
					<Tabs.List mb="xs">
						<Tabs.Tab
							value="contents"
							leftSection={<IconBucketDroplet size={16} />}
						>
							Contents
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
						<Stack>
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
							{loaderData.collectionContents.results.items.length > 0 ? (
								<ApplicationGrid>
									{loaderData.collectionContents.results.items.map((lm) => {
										const atIndex = bulkRemoveItems.findIndex(
											(i) => i.entityId === lm.entityId,
										);
										return (
											<DisplayCollectionEntity
												key={lm.entityId}
												entityId={lm.entityId}
												entityLot={lm.entityLot}
												topRight={
													isBulkRemoving ? (
														<ActionIcon
															variant={
																atIndex !== -1 ? "filled" : "transparent"
															}
															color="red"
															onClick={(e) => {
																e.preventDefault();
																if (atIndex === -1)
																	addBulkRemoveItem(lm.entityId, lm.entityLot);
																else bulkRemoveItemsHandler.remove(atIndex);
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
							{loaderData.collectionContents.details ? (
								<Center>
									<Pagination
										size="sm"
										value={loaderData.query.page}
										onChange={(v) => setP("page", v.toString())}
										total={Math.ceil(
											loaderData.collectionContents.results.details.total /
												coreDetails.pageLimit,
										)}
									/>
								</Center>
							) : null}
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="actions">
						<SimpleGrid cols={{ base: 2, md: 3, lg: 4 }} spacing="lg">
							<Button
								variant="outline"
								w="100%"
								onClick={() => {
									setEntityToReview({
										entityId: loaderData.collectionId,
										entityLot: EntityLot.Collection,
										entityTitle: loaderData.collectionContents.details.name,
									});
								}}
							>
								Post a review
							</Button>
							<Button
								variant="outline"
								w="100%"
								onClick={() => {
									setIsBulkRemoving(true);
									setTab("contents");
								}}
							>
								Bulk remove
							</Button>
						</SimpleGrid>
					</Tabs.Panel>
					{!userPreferences.general.disableReviews ? (
						<Tabs.Panel value="reviews">
							{loaderData.collectionContents.reviews.length > 0 ? (
								<Stack>
									{loaderData.collectionContents.reviews.map((r) => (
										<ReviewItemDisplay
											title={loaderData.collectionContents.details.name}
											review={r}
											key={r.id}
											entityId={loaderData.collectionId}
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
					.filter((o) => o !== EntityLot.Collection)
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
