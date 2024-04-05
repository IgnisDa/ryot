import {
	ActionIcon,
	Box,
	Button,
	Center,
	Container,
	Flex,
	Group,
	Modal,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	EntityLot,
	GraphqlSortOrder,
	MediaLot,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconFilter,
	IconFilterOff,
	IconMessageCircle2,
	IconSortAscending,
	IconSortDescending,
	IconUser,
} from "@tabler/icons-react";
import { useState } from "react";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	ApplicationPagination,
	DebouncedSearchInput,
} from "~/components/common";
import {
	MediaItemWithoutUpdateModal,
	type PostReview,
	PostReviewModal,
	ReviewItemDisplay,
} from "~/components/media";
import { dayjsLib } from "~/lib/generals";
import { useSearchParam } from "~/lib/hooks";
import {
	getAuthorizationHeader,
	getCoreDetails,
	getUserDetails,
	getUserPreferences,
	gqlClient,
} from "~/lib/utilities.server";

const defaultFiltersValue = {
	sort: CollectionContentsSortBy.LastUpdatedOn,
	order: GraphqlSortOrder.Desc,
};

const searchParamsSchema = z.object({
	defaultTab: z.string().optional().default("contents"),
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const id = params.id ? Number(params.id) : null;
	invariant(id, "No ID provided");
	const query = zx.parseQuery(request, searchParamsSchema);
	const { collectionContents: info } = await gqlClient.request(
		CollectionContentsDocument,
		{ input: { collectionId: id, take: 0 } },
		await getAuthorizationHeader(request),
	);
	const { collectionContents: contents } = await gqlClient.request(
		CollectionContentsDocument,
		{
			input: {
				collectionId: id,
				filter: {
					entityType: query.entityLot,
					metadataLot: query.metadataLot,
				},
				sort: { by: query.sortBy, order: query.orderBy },
				search: {
					page: query.page,
					query: query.query,
				},
			},
		},
		await getAuthorizationHeader(request),
	);
	const [coreDetails, userPreferences, userDetails] = await Promise.all([
		getCoreDetails(request),
		getUserPreferences(request),
		getUserDetails(request),
	]);
	return json({
		id,
		query,
		info,
		contents: contents.results,
		coreDetails: { pageLimit: coreDetails.pageLimit },
		userPreferences: { reviewScale: userPreferences.general.reviewScale },
		userDetails,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).info.details.name
			} | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [_, { setP }] = useSearchParam();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [postReviewModalData, setPostReviewModalData] = useState<
		PostReview | undefined
	>(undefined);

	return (
		<>
			<PostReviewModal
				onClose={() => setPostReviewModalData(undefined)}
				opened={postReviewModalData !== undefined}
				data={postReviewModalData}
				entityType="collection"
				objectId={loaderData.id}
				reviewScale={loaderData.userPreferences.reviewScale}
				title={loaderData.info.details.name}
			/>
			<Container>
				<Stack>
					<Box>
						<Text c="dimmed" size="xs" mb={-10}>
							{changeCase(loaderData.info.details.visibility)}
						</Text>
						<Title>{loaderData.info.details.name}</Title>{" "}
						<Text size="sm">
							{loaderData.contents.details.total} items, created by{" "}
							{loaderData.info.user.name}{" "}
							{dayjsLib(loaderData.info.details.createdOn).fromNow()}
						</Text>
					</Box>
					<Text>{loaderData.info.details.description}</Text>
					<Tabs defaultValue={loaderData.query.defaultTab}>
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
							{loaderData.info.reviews.length > 0 ? (
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
										placeholder="Search in the collection"
										initialValue={loaderData.query.query}
									/>
									<ActionIcon
										onClick={openFiltersModal}
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
											<Flex gap="xs" align="center">
												<Select
													w="100%"
													data={[
														{
															group: "Sort by",
															items: Object.values(
																CollectionContentsSortBy,
															).map((o) => ({
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
														if (
															loaderData.query.orderBy === GraphqlSortOrder.Asc
														)
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
												data={Object.values(EntityLot).map((o) => ({
													value: o.toString(),
													label: startCase(o.toLowerCase()),
												}))}
												onChange={(v) => setP("entityLot", v)}
												clearable
											/>
											{loaderData.query.entityLot === EntityLot.Media ||
											loaderData.query.entityLot === EntityLot.MediaGroup ? (
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
										</Stack>
									</Modal>
								</Group>
								{loaderData.contents.items.length > 0 ? (
									<ApplicationGrid>
										{loaderData.contents.items.map((lm) => (
											<MediaItemWithoutUpdateModal
												noRatingLink
												key={lm.details.identifier}
												item={{
													...lm.details,
													publishYear: lm.details.publishYear?.toString(),
												}}
												lot={lm.metadataLot}
												entityLot={lm.entityLot}
												reviewScale={loaderData.userPreferences.reviewScale}
											/>
										))}
									</ApplicationGrid>
								) : (
									<Text>You have not added any media to this collection</Text>
								)}
								{loaderData.contents.details ? (
									<Center>
										<ApplicationPagination
											value={loaderData.query.page}
											onChange={(v) => setP("page", v.toString())}
											total={Math.ceil(
												loaderData.contents.details.total /
													loaderData.coreDetails.pageLimit,
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
										setPostReviewModalData({});
									}}
								>
									Post a review
								</Button>
							</SimpleGrid>
						</Tabs.Panel>
						<Tabs.Panel value="reviews">
							<Stack>
								{loaderData.info.reviews.map((r) => (
									<ReviewItemDisplay
										title={loaderData.info.details.name}
										review={r}
										key={r.id}
										collectionId={loaderData.id}
										reviewScale={loaderData.userPreferences.reviewScale}
										user={loaderData.userDetails}
										entityType="collection"
									/>
								))}
							</Stack>
						</Tabs.Panel>
					</Tabs>
				</Stack>
			</Container>
		</>
	);
}
