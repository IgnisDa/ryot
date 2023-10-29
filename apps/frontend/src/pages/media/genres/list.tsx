import Grid from "@/lib/components/Grid";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getStringAsciiValue } from "@/lib/utilities";
import {
	ActionIcon,
	Anchor,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Pagination,
	Paper,
	Stack,
	Text,
	TextInput,
	Title,
	useMantineTheme,
} from "@mantine/core";
import { useDebouncedState, useLocalStorage } from "@mantine/hooks";
import { GenresListDocument } from "@ryot/generated/graphql/backend/graphql";
import { IconRefresh, IconSearch, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useEffect } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	const [query, setQuery] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedGenreQuery,
		getInitialValueInEffect: false,
	});
	const [activePage, setPage] = useLocalStorage({
		defaultValue: "1",
		key: LOCAL_STORAGE_KEYS.savedGenrePage,
		getInitialValueInEffect: false,
	});
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);
	const coreDetails = useCoreDetails();

	const listGenres = useQuery({
		queryKey: ["genresList", activePage, debouncedQuery],
		queryFn: async () => {
			if (typeof debouncedQuery === "undefined") return;
			const { genresList } = await gqlClient.request(GenresListDocument, {
				input: {
					page: Number(activePage || 1),
					query: debouncedQuery.length > 0 ? debouncedQuery : undefined,
				},
			});
			return genresList;
		},
		staleTime: Infinity,
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim() || "");
	}, [query]);

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size={16} />
			</ActionIcon>
		) : undefined;

	return coreDetails.data ? (
		<>
			<Head>
				<title>List Genres | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Flex align="center" gap="md">
						<Title>Genres</Title>
					</Flex>
					<Group wrap="nowrap">
						<TextInput
							name="query"
							placeholder="Search for genres"
							leftSection={<IconSearch />}
							onChange={(e) => setQuery(e.currentTarget.value)}
							value={query}
							rightSection={<ClearButton />}
							style={{ flexGrow: 1 }}
							autoCapitalize="none"
							autoComplete="off"
						/>
						<ActionIcon
							onClick={() => listGenres.refetch()}
							loading={listGenres.isLoading}
						>
							<IconRefresh />
						</ActionIcon>
					</Group>
					{listGenres.data && listGenres.data.details.total > 0 ? (
						<>
							<Box>
								<Text display="inline" fw="bold">
									{listGenres.data.details.total}
								</Text>{" "}
								items found
							</Box>
							<Grid>
								{listGenres.data.items.map((genre) => (
									<Paper key={genre.id}>
										<Group>
											<Box
												h={11}
												w={11}
												style={{ borderRadius: 2 }}
												bg={
													colors[
														(getStringAsciiValue(genre.name) + colors.length) %
															colors.length
													]
												}
											/>
											<Box>
												<Anchor
													component={Link}
													href={withQuery(APP_ROUTES.media.genres.details, {
														id: genre.id,
													})}
												>
													{genre.name.substring(0, 15)}
												</Anchor>
												<Text>{genre.numItems} items</Text>
											</Box>
										</Group>
									</Paper>
								))}
							</Grid>
						</>
					) : (
						<Text>No information to display</Text>
					)}
					{listGenres.data ? (
						<Center mt="xl">
							<Pagination
								size="sm"
								value={parseInt(activePage || "1")}
								onChange={(v) => setPage(v.toString())}
								total={Math.ceil(
									listGenres.data.details.total / coreDetails.data.pageLimit,
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
