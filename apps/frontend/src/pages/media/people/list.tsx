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
	Grid as MantineGrid,
	Pagination,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useDebouncedState, useLocalStorage } from "@mantine/hooks";
import { CreatorsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { getInitials } from "@ryot/ts-utils";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement, useEffect } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

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
	const coreDetails = useCoreDetails();

	const listCreators = useQuery({
		queryKey: ["creatorsList", activePage, debouncedQuery],
		queryFn: async () => {
			const { creatorsList } = await gqlClient.request(CreatorsListDocument, {
				input: {
					page: Number(activePage || 1),
					query: debouncedQuery.length > 0 ? debouncedQuery : undefined,
				},
			});
			return creatorsList;
		},
		staleTime: Infinity,
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim() || "");
	}, [query]);

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size="1rem" />
			</ActionIcon>
		) : undefined;

	return coreDetails.data ? (
		<>
			<Head>
				<title>List People | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<MantineGrid grow>
						<MantineGrid.Col span={12}>
							<TextInput
								name="query"
								placeholder={"Search for people"}
								icon={<IconSearch />}
								onChange={(e) => setQuery(e.currentTarget.value)}
								value={query}
								rightSection={<ClearButton />}
								style={{ flexGrow: 1 }}
								autoCapitalize="none"
								autoComplete="off"
							/>
						</MantineGrid.Col>
					</MantineGrid>
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
								value={parseInt(activePage)}
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
