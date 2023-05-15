import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import MediaItem, {
	MediaItemWithoutUpdateModal,
} from "@/lib/components/MediaItem";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { changeCase, getLot } from "@/lib/utilities";
import {
	ActionIcon,
	Box,
	Center,
	Container,
	Group,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
	TextInput,
} from "@mantine/core";
import { useLocalStorage, useToggle } from "@mantine/hooks";
import {
	AudioBooksSearchDocument,
	BooksSearchDocument,
	MediaListDocument,
	MediaSortBy,
	MediaSortOrder,
	MetadataLot,
	MoviesSearchDocument,
	PodcastsSearchDocument,
	ShowsSearchDocument,
	VideoGamesSearchDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconListCheck,
	IconRefresh,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { lowerCase, startCase } from "lodash";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";

const LIMIT = 20;

const Page: NextPageWithLayout = () => {
	const [activeTab, setActiveTab] = useState<string | null>("mine");
	const [mineSortOrder, toggleMineSortOrder] = useToggle(
		Object.values(MediaSortOrder),
	);
	const [mineSortBy, setMineSortBy] = useState(MediaSortBy.ReleaseDate);
	const [activeSearchPage, setSearchPage] = useLocalStorage({
		key: "savedSearchPage",
	});
	const [query, setQuery] = useLocalStorage({
		key: "savedQuery",
		getInitialValueInEffect: false,
	});
	const [activeMinePage, setMinePage] = useLocalStorage({
		key: "savedMinePage",
		getInitialValueInEffect: false,
	});
	const router = useRouter();
	const lot = getLot(router.query.lot);
	const offset = (parseInt(activeSearchPage || "1") - 1) * LIMIT;
	const listMedia = useQuery({
		queryKey: ["listMedia", activeMinePage, lot, mineSortBy, mineSortOrder],
		queryFn: async () => {
			invariant(lot, "Lot is not defined");
			const { mediaList } = await gqlClient.request(MediaListDocument, {
				input: {
					lot,
					page: parseInt(activeMinePage) || 1,
					sort: { order: mineSortOrder, by: mineSortBy },
				},
			});
			return mediaList;
		},
		onSuccess: () => {
			if (!activeMinePage) setMinePage("1");
		},
		enabled: lot !== undefined,
	});
	const searchQuery = useQuery({
		queryKey: ["searchQuery", activeSearchPage, lot, query],
		queryFn: async () => {
			invariant(lot, "Lot must be defined");
			return await match(lot)
				.with(MetadataLot.Book, async () => {
					const { booksSearch } = await gqlClient.request(BooksSearchDocument, {
						input: { query, page: parseInt(activeSearchPage) || 1 },
					});
					return booksSearch;
				})
				.with(MetadataLot.Movie, async () => {
					const { moviesSearch } = await gqlClient.request(
						MoviesSearchDocument,
						{
							input: { query, page: parseInt(activeSearchPage) || 1 },
						},
					);
					return moviesSearch;
				})
				.with(MetadataLot.Show, async () => {
					const { showSearch } = await gqlClient.request(ShowsSearchDocument, {
						input: { query, page: parseInt(activeSearchPage) || 1 },
					});
					return showSearch;
				})
				.with(MetadataLot.VideoGame, async () => {
					const { videoGamesSearch } = await gqlClient.request(
						VideoGamesSearchDocument,
						{
							input: { query, page: parseInt(activeSearchPage) || 1 },
						},
					);
					return videoGamesSearch;
				})
				.with(MetadataLot.AudioBook, async () => {
					const { audioBooksSearch } = await gqlClient.request(
						AudioBooksSearchDocument,
						{
							input: { query, page: parseInt(activeSearchPage) || 1 },
						},
					);
					return audioBooksSearch;
				})
				.with(MetadataLot.Podcast, async () => {
					const { podcastsSearch } = await gqlClient.request(
						PodcastsSearchDocument,
						{
							input: { query, page: parseInt(activeSearchPage) || 1 },
						},
					);
					return podcastsSearch;
				})
				.exhaustive();
		},
		onSuccess: () => {
			if (!activeSearchPage) setSearchPage("1");
		},
		enabled: query !== "" && lot !== undefined && activeTab === "search",
		staleTime: Infinity,
	});

	return lot ? (
		<Container>
			<Tabs variant="outline" value={activeTab} onTabChange={setActiveTab}>
				<Tabs.List mb={"xs"}>
					<Tabs.Tab value="mine" icon={<IconListCheck size="1.5rem" />}>
						<Text size={"lg"}>My {changeCase(lot.toLowerCase())}s</Text>
					</Tabs.Tab>
					<Tabs.Tab value="search" icon={<IconSearch size="1.5rem" />}>
						<Text size={"lg"}>Search</Text>
					</Tabs.Tab>
					<Box style={{ flexGrow: 1 }}>
						<ActionIcon
							size="lg"
							variant="transparent"
							ml="auto"
							mt="xs"
							loading={searchQuery.isFetching || listMedia.isFetching}
							onClick={() => {
								searchQuery.refetch();
								listMedia.refetch();
							}}
						>
							<IconRefresh size="1.625rem" />
						</ActionIcon>
					</Box>
				</Tabs.List>

				<Tabs.Panel value="mine">
					<Stack>
						<Group>
							<Select
								size="xs"
								data={Object.values(MediaSortBy).map((o) => ({
									value: o.toString(),
									label: startCase(lowerCase(o)),
								}))}
								defaultValue={mineSortBy.toString()}
								onChange={(v) => {
									const orderBy = match(v)
										.with("RELEASE_DATE", () => MediaSortBy.ReleaseDate)
										.with("TITLE", () => MediaSortBy.Title)
										.otherwise(() => MediaSortBy.Title);
									setMineSortBy(orderBy);
								}}
							/>
							<ActionIcon onClick={() => toggleMineSortOrder()}>
								{mineSortOrder === MediaSortOrder.Asc ? (
									<IconSortAscending />
								) : (
									<IconSortDescending />
								)}
							</ActionIcon>
						</Group>
						{listMedia.data && listMedia.data.total > 0 ? (
							<>
								<Grid>
									{listMedia.data.items.map((lm) => (
										<MediaItemWithoutUpdateModal
											key={lm.identifier}
											item={lm}
											lot={lot}
											imageOnClick={async () => parseInt(lm.identifier)}
										/>
									))}
								</Grid>
							</>
						) : (
							<Text>You do not have any saved yet</Text>
						)}
						{listMedia.data && (
							<Center>
								<Pagination
									size="sm"
									value={parseInt(activeMinePage)}
									onChange={(v) => setMinePage(v.toString())}
									total={Math.ceil(listMedia.data.total / LIMIT)}
									boundaries={1}
									siblings={0}
								/>
							</Center>
						)}
					</Stack>
				</Tabs.Panel>

				<Tabs.Panel value="search">
					<Stack>
						<TextInput
							name="query"
							placeholder={`Search for a ${lot.toLowerCase()}`}
							icon={<IconSearch />}
							defaultValue={query}
							style={{ flexGrow: 1 }}
							onChange={(e) => setQuery(e.currentTarget.value)}
						/>
						{searchQuery.data && searchQuery.data.total > 0 ? (
							<Grid>
								{searchQuery.data.items.map((b, idx) => (
									<MediaItem
										idx={idx}
										key={b.identifier}
										item={b}
										query={query}
										offset={offset}
										lot={lot}
										refetch={searchQuery.refetch}
									/>
								))}
							</Grid>
						) : (
							<Text>No media found :(</Text>
						)}
						{searchQuery.data && (
							<Center>
								<Pagination
									size="sm"
									value={parseInt(activeSearchPage)}
									onChange={(v) => setSearchPage(v.toString())}
									total={Math.ceil(searchQuery.data.total / LIMIT)}
									boundaries={1}
									siblings={0}
								/>
							</Center>
						)}
					</Stack>
				</Tabs.Panel>
			</Tabs>
		</Container>
	) : null;
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
