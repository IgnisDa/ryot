import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Alert,
	Container,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	CollectionsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconAlertCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(
			CollectionsDocument,
		);
		return collections
	});

	return (
		<Container>
			<Stack>
				{collections.data && collections.data.length > 0 ? (
					collections.data.map(c => (
						<Stack key={c.collectionDetails.id}>
							<Title order={3} truncate>{c.collectionDetails.name}</Title>
							{c.mediaDetails.length > 0 ?
								(

									<Grid>
										{c.mediaDetails.map((lm) => (
											<MediaItemWithoutUpdateModal
												key={lm.identifier}
												item={lm}
												lot={lm.lot}
												imageOnClick={async () => parseInt(lm.identifier)}
											/>
										))}
									</Grid>
								) : <Text>No items in this collection</Text>
							}
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
