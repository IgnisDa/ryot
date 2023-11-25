import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, json } from "@remix-run/node";

export type SearchParams = {
	selectedShowSeasonNumber?: number;
	selectedShowEpisodeNumber?: number;
	onlySeason?: boolean;
	selectedPodcastEpisodeNumber?: number;
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
