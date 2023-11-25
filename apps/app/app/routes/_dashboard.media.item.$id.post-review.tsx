import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, json } from "@remix-run/node";

export type SearchParams = {
	entityType:
		| "media"
		| "mediaGroup"
		| "collection"
		| "person"
		| "existingReview";
	showSeasonNumber?: number;
	showEpisodeNumber?: number;
	podcastEpisodeNumber?: number;
};

export const loader = async (_args: LoaderFunctionArgs) => {
	return json({});
};

export default function Page() {
	return (
		<Container>
			<Box>Hello world!</Box>
		</Container>
	);
}
