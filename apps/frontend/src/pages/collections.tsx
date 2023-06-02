import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import { ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Alert,
	Button,
	Container,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	CollectionsDocument,
	DeleteCollectionDocument,
	type DeleteCollectionMutationVariables,
	RemoveMediaFromCollectionDocument,
	type RemoveMediaFromCollectionMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { IconAlertCircle, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import type { ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(CollectionsDocument);
		return collections;
	});
	const deleteCollection = useMutation({
		mutationFn: async (variables: DeleteCollectionMutationVariables) => {
			const { deleteCollection } = await gqlClient.request(
				DeleteCollectionDocument,
				variables,
			);
			return deleteCollection;
		},
		onSuccess: () => {
			collections.refetch();
		},
		onError: (err: any) => {
			notifications.show({
				title: "Error",
				color: "red",
				message: err.response.errors[0].message,
			});
		},
	});
	const removeMediaFromCollection = useMutation({
		mutationFn: async (
			variables: RemoveMediaFromCollectionMutationVariables,
		) => {
			const { removeMediaFromCollection } = await gqlClient.request(
				RemoveMediaFromCollectionDocument,
				variables,
			);
			return removeMediaFromCollection;
		},
		onSuccess: () => {
			collections.refetch();
		},
	});

	return (
		<>
			<Head>
				<title>Collections | Ryot</title>
			</Head>
			<Container>
				<Stack>
					{collections.data && collections.data.length > 0 ? (
						collections.data.map((collection) => (
							<Stack key={collection.collectionDetails.id}>
								<Group>
									<Title order={3} truncate>
										{collection.collectionDetails.name}
									</Title>
									<ActionIcon
										onClick={() => {
											const yes = confirm(
												"Are you sure you want to delete this collection?",
											);
											if (yes)
												deleteCollection.mutate({
													collectionName: collection.collectionDetails.name,
												});
										}}
										color="red"
									>
										<IconTrash size="1.3rem" />
									</ActionIcon>
								</Group>
								{collection.mediaDetails.length > 0 ? (
									<Grid>
										{collection.mediaDetails.map((mediaItem) => (
											<MediaItemWithoutUpdateModal
												key={mediaItem.identifier}
												item={mediaItem}
												lot={mediaItem.lot}
												href={`${ROUTES.media.details}?item=${mediaItem.identifier}`}
											>
												<Button
													fullWidth
													color="red"
													variant="outline"
													onClick={() => {
														const yes = confirm(
															"Are you sure you want to remove this media from this collection?",
														);
														if (yes)
															removeMediaFromCollection.mutate({
																collectionName:
																	collection.collectionDetails.name,
																metadataId: Number(mediaItem.identifier),
															});
													}}
												>
													Remove
												</Button>
											</MediaItemWithoutUpdateModal>
										))}
									</Grid>
								) : (
									<Text>No items in this collection</Text>
								)}
							</Stack>
						))
					) : (
						<Alert color="yellow" icon={<IconAlertCircle size="1rem" />}>
							You do not have any collections. You can create and add media to
							collections from a media's details page.
						</Alert>
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
