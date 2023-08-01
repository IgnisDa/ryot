import type { NextPageWithLayout } from "../../_app";
import Grid from "@/lib/components/Grid";
import { BaseDisplayItem } from "@/lib/components/MediaItem";
import { APP_ROUTES, LIMIT } from "@/lib/constants";
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
import { getInitials } from "@ryot/utilities";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement, useEffect } from "react";
import { withQuery } from "ufo";

const Page: NextPageWithLayout = () => {
	const [query, setQuery] = useLocalStorage({
		key: "savedCreatorsQuery",
		getInitialValueInEffect: false,
	});
	const [activePage, setPage] = useLocalStorage({
		key: "savedCreatorPage",
		getInitialValueInEffect: false,
	});
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);

	const listCreators = useQuery({
		queryKey: ["creatorsList", activePage, debouncedQuery],
		queryFn: async () => {
			const { creatorsList } = await gqlClient.request(CreatorsListDocument, {
				input: {
					page: Number(activePage || 1),
					query: debouncedQuery.length > 0 ? debouncedQuery : null,
				},
			});
			return creatorsList;
		},
		onSuccess: () => {
			if (!activePage) setPage("1");
		},
		staleTime: Infinity,
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim());
	}, [query]);

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size="1rem" />
			</ActionIcon>
		) : null;

	return (
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
					{listCreators.data && listCreators.data.total > 0 ? (
						<>
							<Box>
								<Text display={"inline"} fw="bold">
									{listCreators.data.total}
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
						<Text>You do not have any saved yet</Text>
					)}
					{listCreators.data && (
						<Center>
							<Pagination
								size="sm"
								value={parseInt(activePage)}
								onChange={(v) => setPage(v.toString())}
								total={Math.ceil(listCreators.data.total / LIMIT)}
								boundaries={1}
								siblings={0}
							/>
						</Center>
					)}
				</Stack>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
