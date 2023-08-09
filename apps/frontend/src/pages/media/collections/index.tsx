import type { NextPageWithLayout } from "../../_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import { APP_ROUTES, LIMIT } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Center,
	Container,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { CollectionContentsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatTimeAgo } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import { withQuery } from "ufo";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const collectionId = parseInt(router.query.collectionId?.toString() || "0");

	const [activePage, setPage] = useLocalStorage({
		key: "savedPage",
		getInitialValueInEffect: false,
	});

	const collectionContents = useQuery(
		["collectionContents", activePage],
		async () => {
			const { collectionContents } = await gqlClient.request(
				CollectionContentsDocument,
				{ input: { collectionId, page: parseInt(activePage) || 1 } },
			);
			return collectionContents;
		},
		{ enabled: !!collectionId },
	);

	return collectionId && collectionContents.data ? (
		<>
			<Head>
				<title>{collectionContents.data.details.name} | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Box>
						<Text color="dimmed" size="xs" mb={-10}>
							{changeCase(collectionContents.data.details.visibility)}
						</Text>
						<Title>{collectionContents.data.details.name}</Title>{" "}
						<Text size="sm">
							{collectionContents.data.results.total} items, created by{" "}
							{collectionContents.data.user.name}{" "}
							{formatTimeAgo(collectionContents.data.details.createdOn)}
						</Text>
					</Box>
					<Text>{collectionContents.data.details.description}</Text>
					{collectionContents.data.results.items.length > 0 ? (
						<Grid>
							{collectionContents.data.results.items.map((lm) => (
								<MediaItemWithoutUpdateModal
									key={lm.identifier}
									item={lm}
									lot={lm.lot}
									href={withQuery(
										APP_ROUTES.media.individualMediaItem.details,
										{ id: lm.identifier },
									)}
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
								value={parseInt(activePage)}
								onChange={(v) => setPage(v.toString())}
								total={Math.ceil(collectionContents.data.results.total / LIMIT)}
								boundaries={1}
								siblings={0}
							/>
						</Center>
					) : null}
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
