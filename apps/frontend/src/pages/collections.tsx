import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Container,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	CollectionsDocument,
} from "@ryot/generated/graphql/backend/graphql";
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
				{collections.data ? (
					collections.data.map(c => (
						<Stack key={c.collectionDetails.id}>
							<Title order={3}>{c.collectionDetails.name}</Title>
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
				) : <Text>You do not have any collections</Text>}
			</Stack>
		</Container>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
