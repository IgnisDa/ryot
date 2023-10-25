import Grid from "@/lib/components/Grid";
import {
	MediaItemWithoutUpdateModal,
	ReviewItemDisplay,
} from "@/lib/components/MediaComponents";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	deserializeLocalStorage,
	serializeLocalStorage,
} from "@/lib/utilities";
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
	TextInput,
	Title,
} from "@mantine/core";
import {
	useDebouncedState,
	useDisclosure,
	useLocalStorage,
} from "@mantine/hooks";
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
	IconFilter,
	IconFilterOff,
	IconMessageCircle2,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
	IconUser,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../_app";

const defaultFiltersValue = {
	by: CollectionContentsSortBy.LastUpdatedOn,
	order: GraphqlSortOrder.Desc,
};

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const collectionId = parseInt(router.query.id?.toString() || "0");
	const coreDetails = useCoreDetails();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [activePage, setPage] = useLocalStorage({
		defaultValue: "1",
		key: LOCAL_STORAGE_KEYS.savedCollectionPage,
		getInitialValueInEffect: false,
	});
	const [activeTab, setActiveTab] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedActiveCollectionDetailsTab,
		getInitialValueInEffect: false,
		defaultValue: "contents",
	});
	const [query, setQuery] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedCollectionContentsQuery,
		getInitialValueInEffect: false,
	});
	const [sortBy, setSortBy] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedCollectionContentsSortBy,
		defaultValue: defaultFiltersValue.by,
		getInitialValueInEffect: false,
	});
	const [sortOrder, setSortOrder] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedCollectionContentsSortOrder,
		defaultValue: defaultFiltersValue.order,
		getInitialValueInEffect: false,
	});
	const [entityLotFilter, setEntityLotFilter] = useLocalStorage<
		EntityLot | undefined
	>({
		key: LOCAL_STORAGE_KEYS.savedCollectionContentsEntityLotFilter,
		getInitialValueInEffect: false,
		deserialize: deserializeLocalStorage as any,
		serialize: serializeLocalStorage,
	});
	const [metadataLotFilter, setMetadataLotFilter] = useLocalStorage<
		MetadataLot | undefined
	>({
		key: LOCAL_STORAGE_KEYS.savedCollectionContentsMetadataLotFilter,
		getInitialValueInEffect: false,
		deserialize: deserializeLocalStorage as any,
		serialize: serializeLocalStorage,
	});
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);

	const collectionDetails = useQuery({
		queryKey: ["collectionDetails"],
		queryFn: async () => {
			const { collectionContents } = await gqlClient.request(
				CollectionContentsDocument,
				{ input: { collectionId, take: 1 } },
			);
			return collectionContents;
		},
		enabled: !!collectionId,
		staleTime: Infinity,
	});

	const collectionContents = useQuery({
		queryKey: [
			"collectionContents",
			activePage,
			debouncedQuery,
			sortBy,
			sortOrder,
			entityLotFilter,
			metadataLotFilter,
		],
		queryFn: async () => {
			const { collectionContents } = await gqlClient.request(
				CollectionContentsDocument,
				{
					input: {
						collectionId,
						filter: {
							entityType: entityLotFilter,
							metadataLot: metadataLotFilter,
						},
						sort: { by: sortBy, order: sortOrder },
						search: {
							page: parseInt(activePage || "1"),
							query: debouncedQuery || undefined,
						},
					},
				},
			);
			return collectionContents;
		},
		enabled: !!collectionId,
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim());
	}, [query]);

	return collectionId && coreDetails.data && collectionDetails.data ? (
		<>
			<Head>
				<title>{collectionDetails.data.details.name} | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Box>
						<Text c="dimmed" size="xs" mb={-10}>
							{changeCase(collectionDetails.data.details.visibility)}
						</Text>
						<Title>{collectionDetails.data.details.name}</Title>{" "}
						<Text size="sm">
							{collectionDetails.data.results.details.total} items, created by{" "}
							{collectionDetails.data.user.name}{" "}
							{formatTimeAgo(collectionDetails.data.details.createdOn)}
						</Text>
					</Box>
					<Text>{collectionDetails.data.details.description}</Text>
					<Tabs
						value={activeTab}
						onChange={(v) => {
							if (v) setActiveTab(v);
						}}
					>
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
							{collectionContents.data &&
							collectionContents.data.reviews.length > 0 ? (
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
											value={parseInt(activePage || "1")}
											onChange={(v) => setPage(v.toString())}
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
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
