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
	Box,
	Button,
	Center,
	Container,
	Pagination,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { CollectionContentsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatTimeAgo } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const collectionId = parseInt(router.query.id?.toString() || "0");
	const coreDetails = useCoreDetails();
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

	const collectionContents = useQuery({
		queryKey: ["collectionContents", activePage],
		queryFn: async () => {
			const { collectionContents } = await gqlClient.request(
				CollectionContentsDocument,
				{
					input: {
						collectionId,
						search: { page: parseInt(activePage || "1") },
					},
				},
			);
			return collectionContents;
		},
		enabled: !!collectionId,
	});

	return collectionId && coreDetails.data && collectionContents.data ? (
		<>
			<Head>
				<title>{collectionContents.data.details.name} | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Box>
						<Text c="dimmed" size="xs" mb={-10}>
							{changeCase(collectionContents.data.details.visibility)}
						</Text>
						<Title>{collectionContents.data.details.name}</Title>{" "}
						<Text size="sm">
							{collectionContents.data.results.details.total} items, created by{" "}
							{collectionContents.data.user.name}{" "}
							{formatTimeAgo(collectionContents.data.details.createdOn)}
						</Text>
					</Box>
					<Text>{collectionContents.data.details.description}</Text>
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
							{collectionContents.data.reviews.length > 0 ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : undefined}
						</Tabs.List>
						<Tabs.Panel value="contents">
							{collectionContents.data.results.items.length > 0 ? (
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
								{collectionContents.data.reviews.map((r) => (
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
