import {
	ActionIcon,
	Box,
	Button,
	Center,
	Container,
	Flex,
	Grid,
	Group,
	Modal,
	Pagination,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	TextInput,
	Title,
	Text,
} from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	EntityLot,
	GraphqlSortOrder,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatTimeAgo, startCase } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconUser,
	IconMessageCircle2,
	IconSearch,
	IconX,
	IconFilter,
	IconFilterOff,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import invariant from "tiny-invariant";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import {
	MediaItemWithoutUpdateModal,
	ReviewItemDisplay,
} from "~/components/media-components";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { useSearchParam } from "~/lib/hooks";

const searchParamsSchema = z.object({
	page: zx.IntAsString.optional(),
	query: z.string().optional(),
	sortBy: z.nativeEnum(CollectionContentsSortBy).optional(),
	orderBy: z.nativeEnum(GraphqlSortOrder).optional(),
	entityLot: z.nativeEnum(EntityLot).optional(),
	metadataLot: z.nativeEnum(MetadataLot).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const id = params.id ? Number(params.id) : undefined;
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
	return json({ id, info, contents: contents.results });
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).details.details.name
			} | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useSearchParam();

	return (
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
						{formatTimeAgo(loaderData.info.details.createdOn)}
					</Text>
				</Box>
				<Text>{loaderData.info.details.description}</Text>
				<Tabs defaultValue="contents">
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
						) : undefined}
					</Tabs.List>
					<Tabs.Panel value="contents">
						<Stack>
							<Group wrap="nowrap">
								<TextInput
									name="query"
									placeholder="Search in the collection"
									leftSection={<IconSearch />}
									onChange={(e) => setQuery(e.currentTarget.value)}
									value={query}
									rightSection={
										query ? (
											<ActionIcon onClick={() => setQuery("")}>
												<IconX size={16} />
											</ActionIcon>
										) : undefined
									}
									style={{ flexGrow: 1 }}
									autoCapitalize="none"
									autoComplete="off"
								/>
								<ActionIcon
									onClick={openFiltersModal}
									color={
										entityLotFilter !== undefined ||
										metadataLotFilter !== undefined ||
										sortBy !== defaultFiltersValue.by ||
										sortOrder !== defaultFiltersValue.order
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
													setSortBy(defaultFiltersValue.by);
													setSortOrder(defaultFiltersValue.order);
													setEntityLotFilter(undefined);
													setMetadataLotFilter(undefined);
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
												value={sortBy?.toString()}
												onChange={(v) => {
													if (v) setSortBy(v as CollectionContentsSortBy);
												}}
											/>
											<ActionIcon
												onClick={() => {
													if (sortOrder === GraphqlSortOrder.Asc)
														setSortOrder(GraphqlSortOrder.Desc);
													else setSortOrder(GraphqlSortOrder.Asc);
												}}
											>
												{sortOrder === GraphqlSortOrder.Asc ? (
													<IconSortAscending />
												) : (
													<IconSortDescending />
												)}
											</ActionIcon>
										</Flex>
										<Select
											placeholder="Select an entity type"
											value={entityLotFilter}
											data={Object.values(EntityLot).map((o) => ({
												value: o.toString(),
												label: startCase(o.toLowerCase()),
											}))}
											onChange={(v) => {
												setEntityLotFilter(v as EntityLot);
											}}
											clearable
										/>
										{entityLotFilter === EntityLot.Media ||
										entityLotFilter === EntityLot.MediaGroup ? (
											<Select
												placeholder="Select a media type"
												value={metadataLotFilter}
												data={Object.values(MetadataLot).map((o) => ({
													value: o.toString(),
													label: startCase(o.toLowerCase()),
												}))}
												onChange={(v) => {
													setMetadataLotFilter(v as MetadataLot);
												}}
												clearable
											/>
										) : undefined}
									</Stack>
								</Modal>
							</Group>
							{collectionContents.data &&
							collectionContents.data.results.items.length > 0 ? (
								<Grid>
									{collectionContents.data.results.items.map((lm) => (
										<MediaItemWithoutUpdateModal
											noRatingLink
											key={lm.details.identifier}
											item={{
												...lm.details,
												publishYear: lm.details.publishYear?.toString(),
											}}
											lot={lm.metadataLot}
											entityLot={lm.entityLot}
										/>
									))}
								</Grid>
							) : (
								<Text>You have not added any media to this collection</Text>
							)}
							{collectionContents.data ? (
								<Center>
									<Pagination
										size="sm"
										value={activePage || 1}
										onChange={(v) => setPage(v)}
										total={Math.ceil(
											collectionContents.data.results.details.total /
												coreDetails.data.pageLimit,
										)}
										boundaries={1}
										siblings={0}
									/>
								</Center>
							) : undefined}
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="actions">
						<SimpleGrid cols={{ base: 2, md: 3, lg: 4 }} spacing="lg">
							<Button
								variant="outline"
								w="100%"
								component={Link}
								href={withQuery(APP_ROUTES.media.postReview, {
									collectionId,
								})}
							>
								Post a review
							</Button>
						</SimpleGrid>
					</Tabs.Panel>
					<Tabs.Panel value="reviews">
						<Stack>
							{collectionContents.data?.reviews.map((r) => (
								<ReviewItemDisplay
									review={r}
									key={r.id}
									collectionId={collectionId}
									refetch={collectionContents.refetch}
								/>
							))}
						</Stack>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
}
