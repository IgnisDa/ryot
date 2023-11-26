import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { ShowAndPodcastSchema } from "~/lib/utils";

const searchParamsSchema = z
	.object({
		entityType: z.enum([
			"media",
			"mediaGroup",
			"collection",
			"person",
			"existingReview",
		]),
		title: z.string(),
		isShow: zx.BoolAsString.optional(),
		isPodcast: zx.BoolAsString.optional(),
		existingReviewId: zx.IntAsString.optional(),
	})
	.merge(ShowAndPodcastSchema);

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const id = params.id;
	invariant(id, "No ID provided");
	return json({ query });
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
