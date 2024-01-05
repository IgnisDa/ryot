import { $path } from "@ignisda/remix-routes";
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
	TextInput,
	Title,
} from "@mantine/core";
import { useDidUpdate, useDisclosure } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	EntityLot,
	GraphqlSortOrder,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconFilter,
	IconFilterOff,
	IconMessageCircle2,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
	IconUser,
	IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, ApplicationPagination } from "~/components/common";
import {
	MediaItemWithoutUpdateModal,
	ReviewItemDisplay,
} from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { dayjsLib } from "~/lib/generals";
import {
	getCoreDetails,
	getUserDetails,
	getUserPreferences,
} from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

const defaultFiltersValue = {
	sort: CollectionContentsSortBy.LastUpdatedOn,
	order: GraphqlSortOrder.Desc,
};

const searchParamsSchema = z.object({
	page: zx.IntAsString.optional(),
	query: z.string().optional(),
	sortBy: z
		.nativeEnum(CollectionContentsSortBy)
		.default(defaultFiltersValue.sort),
	orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFiltersValue.order),
	entityLot: z.nativeEnum(EntityLot).optional(),
	metadataLot: z.nativeEnum(MetadataLot).optional(),
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
		getCoreDetails(),
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
	const [query, setQuery] = useState(loaderData.query.query || "");
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	useDidUpdate(() => setP("query", query), [query]);

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
						{dayjsLib(loaderData.info.details.createdOn).fromNow()}
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
						) : null}
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
										) : null
									}
									style={{ flexGrow: 1 }}
									autoCapitalize="none"
									autoComplete="off"
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
												data={Object.values(MetadataLot).map((o) => ({
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
										size="sm"
										defaultValue={loaderData.query.page}
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
								component={Link}
								to={$path(
									"/media/:id/post-review",
									{ id: loaderData.id },
									{
										entityType: "collection",
										title: loaderData.info.details.name,
									},
								)}
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
								/>
							))}
						</Stack>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
}
