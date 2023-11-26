import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { z } from "zod";
import { ShowAndPodcastSchema } from "~/lib/utils";

export type SearchParams = z.infer<typeof ShowAndPodcastSchema> & {
	entityType:
		| "media"
		| "mediaGroup"
		| "collection"
		| "person"
		| "existingReview";
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
