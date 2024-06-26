import {
	ActionIcon,
	Box,
	Button,
	Center,
	Container,
	Flex,
	Group,
	Modal,
	Pagination,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineLoader } from "@remix-run/node";
import {
	type MetaArgs_SingleFetch,
	useLoaderData,
	useNavigate,
} from "@remix-run/react";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	EntityLot,
	GraphqlSortOrder,
	MediaLot,
} from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconFilter,
	IconFilterOff,
	IconMessageCircle2,
	IconSortAscending,
	IconSortDescending,
	IconUser,
} from "@tabler/icons-react";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, DebouncedSearchInput } from "~/components/common";
import {
	MediaItemWithoutUpdateModal,
	ReviewItemDisplay,
} from "~/components/media";
import { dayjsLib } from "~/lib/generals";
import {
	useCoreDetails,
	useSearchParam,
	useUserPreferences,
} from "~/lib/hooks";
import { useReviewEntity } from "~/lib/state/media";
import {
	getAuthorizationHeader,
	serverGqlService,
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

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const id = params.id;
	invariant(id);
	const query = zx.parseQuery(request, searchParamsSchema);
	const { collectionContents: info } = await serverGqlService.request(
		CollectionContentsDocument,
		{ input: { collectionId: id, take: 0 } },
		getAuthorizationHeader(request),
	);
	const [{ collectionContents: contents }] = await Promise.all([
		serverGqlService.request(
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
			getAuthorizationHeader(request),
		),
	]);
	return { id, query, info, contents: contents.results };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.info.details.name} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const coreDetails = useCoreDetails();
	const navigate = useNavigate();
	const [_, { setP }] = useSearchParam();
	const [_r, setEntityToReview] = useReviewEntity();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	return (
		<Container>
			<Stack>
				<Box>
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
														items: Object.values(CollectionContentsSortBy).map(
															(o) => ({
																value: o.toString(),
																label: startCase(o.toLowerCase()),
															}),
														),
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
									</Stack>
								</Modal>
							</Group>
							{loaderData.contents.items.length > 0 ? (
								<ApplicationGrid>
									{loaderData.contents.items.map((lm) => (
										<MediaItemWithoutUpdateModal
											key={lm.details.identifier}
											item={{
												...lm.details,
												publishYear: lm.details.publishYear?.toString(),
											}}
											lot={lm.metadataLot}
											entityLot={lm.entityLot}
											reviewScale={userPreferences.general.reviewScale}
										/>
									))}
								</ApplicationGrid>
							) : (
								<Text>You have not added anything this collection</Text>
							)}
							{loaderData.contents.details ? (
								<Center>
									<Pagination
										size="sm"
										value={loaderData.query.page}
										onChange={(v) => setP("page", v.toString())}
										total={Math.ceil(
											loaderData.contents.details.total / coreDetails.pageLimit,
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
										entityId: loaderData.id,
										entityLot: EntityLot.Collection,
										entityTitle: loaderData.info.details.name,
									});
								}}
							>
								Post a review
							</Button>
						</SimpleGrid>
					</Tabs.Panel>
					{!userPreferences.general.disableReviews ? (
						<Tabs.Panel value="reviews">
							{loaderData.info.reviews.length > 0 ? (
								<Stack>
									{loaderData.info.reviews.map((r) => (
										<ReviewItemDisplay
											title={loaderData.info.details.name}
											review={r}
											key={r.id}
											entityId={loaderData.id}
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
