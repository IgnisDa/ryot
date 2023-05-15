import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Alert, Button, Container, Stack, Text, Title } from "@mantine/core";
import {
	CollectionsDocument,
	RemoveMediaFromCollectionDocument,
	type RemoveMediaFromCollectionMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(CollectionsDocument);
		return collections;
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
		<Container>
			<Stack>
				{collections.data && collections.data.length > 0 ? (
					collections.data.map((collection) => (
						<Stack key={collection.collectionDetails.id}>
							<Title order={3} truncate>
								{collection.collectionDetails.name}
							</Title>
							{collection.mediaDetails.length > 0 ? (
								<Grid>
									{collection.mediaDetails.map((mediaItem) => (
										<MediaItemWithoutUpdateModal
											key={mediaItem.identifier}
											item={mediaItem}
											lot={mediaItem.lot}
											imageOnClick={async () => parseInt(mediaItem.identifier)}
										>
											<Button
												fullWidth
												color="red"
												variant="outline"
												onClick={() => {
													removeMediaFromCollection.mutate({
														collectionName: collection.collectionDetails.name,
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
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
