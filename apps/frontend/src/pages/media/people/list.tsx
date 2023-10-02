import Grid from "@/lib/components/Grid";
import { BaseDisplayItem } from "@/lib/components/MediaComponents";
import { APP_ROUTES } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Modal,
	Pagination,
	Select,
	Stack,
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
	CreatorSortBy,
	CreatorsListDocument,
	GraphqlSortOrder,
} from "@ryot/generated/graphql/backend/graphql";
import { getInitials, startCase } from "@ryot/ts-utils";
import {
	IconFilter,
	IconFilterOff,
	IconRefresh,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement, useEffect } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const defaultFilters = {
	sortBy: CreatorSortBy.MediaItems,
	sortOrder: GraphqlSortOrder.Desc,
};

const Page: NextPageWithLayout = () => {
	const [query, setQuery] = useLocalStorage({
		key: "savedCreatorsQuery",
		getInitialValueInEffect: false,
	});
	const [activePage, setPage] = useLocalStorage({
		defaultValue: "1",
		key: "savedCreatorPage",
		getInitialValueInEffect: false,
	});
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const coreDetails = useCoreDetails();
	const [sortBy, setSortBy] = useLocalStorage({
		key: "creatorSortBy",
		defaultValue: defaultFilters.sortBy,
		getInitialValueInEffect: false,
	});
	const [sortOrder, setSortOrder] = useLocalStorage({
		key: "creatorSortOrder",
		defaultValue: defaultFilters.sortOrder,
		getInitialValueInEffect: false,
	});

	const listCreators = useQuery({
		queryKey: ["creatorsList", activePage, debouncedQuery, sortBy, sortOrder],
		queryFn: async () => {
			if (typeof debouncedQuery === "undefined") return;
			const { creatorsList } = await gqlClient.request(CreatorsListDocument, {
				input: {
					search: {
						page: parseInt(activePage || "1"),
						query: debouncedQuery.length > 0 ? debouncedQuery : undefined,
					},
					sort: { by: sortBy, order: sortOrder },
				},
			});
			return creatorsList;
		},
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim() || "");
	}, [query]);

	const isFilterChanged = sortBy !== defaultFilters.sortBy;

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size="1rem" />
			</ActionIcon>
		) : undefined;

	const resetFilters = () => {
		setSortBy(defaultFilters.sortBy);
		setSortOrder(defaultFilters.sortOrder);
	};

	return coreDetails.data ? (
		<>
			<Head>
				<title>List People | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Flex align={"center"} gap={"md"}>
						<Title>People</Title>
					</Flex>
					<Group wrap="nowrap">
						<TextInput
							name="query"
							placeholder={"Search for people"}
							leftSection={<IconSearch />}
							onChange={(e) => setQuery(e.currentTarget.value)}
							value={query}
							rightSection={<ClearButton />}
							style={{ flexGrow: 1 }}
							autoCapitalize="none"
							autoComplete="off"
						/>
						<ActionIcon
							onClick={() => listCreators.refetch()}
							loading={listCreators.isLoading}
						>
							<IconRefresh />
						</ActionIcon>
						<ActionIcon
							onClick={openFiltersModal}
							color={isFilterChanged ? "blue" : "gray"}
						>
							<IconFilter size="1.5rem" />
						</ActionIcon>
						<Modal
							opened={filtersModalOpened}
							onClose={closeFiltersModal}
							centered
							withCloseButton={false}
						>
							<Stack>
								<Group>
									<Title order={3}>Sort by</Title>
									<ActionIcon onClick={resetFilters}>
										<IconFilterOff size="1.5rem" />
									</ActionIcon>
								</Group>
								<Flex gap={"xs"} align={"center"}>
									<Select
										w="100%"
										data={Object.values(CreatorSortBy).map((o) => ({
											value: o.toString(),
											label: startCase(o.toLowerCase()),
										}))}
										value={sortBy?.toString()}
										onChange={(v) => {
											if (v) setSortBy(v as CreatorSortBy);
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
							</Stack>
						</Modal>
					</Group>
					{listCreators.data && listCreators.data.details.total > 0 ? (
						<>
							<Box>
								<Text display={"inline"} fw="bold">
									{listCreators.data.details.total}
								</Text>{" "}
								items found
							</Box>
							<Grid>
								{listCreators.data.items.map((creator) => (
									<BaseDisplayItem
										name={creator.name}
										bottomLeft={`${creator.mediaCount} items`}
										imageLink={creator.image}
										imagePlaceholder={getInitials(creator.name)}
										key={creator.id}
										href={withQuery(APP_ROUTES.media.people.details, {
											id: creator.id,
										})}
									/>
								))}
							</Grid>
						</>
					) : (
						<Text>No information to display</Text>
					)}
					{listCreators.data ? (
						<Center>
							<Pagination
								size="sm"
								value={parseInt(activePage || "1")}
								onChange={(v) => setPage(v.toString())}
								total={Math.ceil(
									listCreators.data.details.total / coreDetails.data.pageLimit,
								)}
								boundaries={1}
								siblings={0}
							/>
						</Center>
					) : undefined}
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
