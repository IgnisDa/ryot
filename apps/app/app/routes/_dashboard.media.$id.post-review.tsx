import {
	Box,
	Button,
	Checkbox,
	Container,
	Flex,
	Input,
	NumberInput,
	Rating,
	SegmentedControl,
	Stack,
	Textarea,
	Title,
} from "@mantine/core";
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	ReviewDocument,
	UserReviewScale,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { IconPercentage } from "@tabler/icons-react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getUserPreferences } from "~/lib/graphql.server";
import { ShowAndPodcastSchema } from "~/lib/utils";

const searchParamsSchema = z
	.object({
		title: z.string(),
		metadataId: zx.IntAsString.optional(),
		metadataGroupId: zx.IntAsString.optional(),
		personId: zx.IntAsString.optional(),
		collectionId: zx.IntAsString.optional(),
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
	const [userPreferences] = await Promise.all([getUserPreferences(request)]);
	let existingReview = undefined;
	if (query.existingReviewId) {
		const reviewId = query.existingReviewId;
		invariant(reviewId, "No existingReviewId provided");
		const { review } = await gqlClient.request(
			ReviewDocument,
			{ reviewId },
			await getAuthorizationHeader(request),
		);
		existingReview = review;
	}
	return json({ query, existingReview, userPreferences });
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container size="xs">
			<Box component={Form} method="post" action="?postReview">
				{loaderData.query.collectionId ? (
					<input
						type="hidden"
						name="collectionId"
						value={loaderData.query.collectionId}
					/>
				) : loaderData.query.metadataId ? (
					<input
						type="hidden"
						name="metadataId"
						value={loaderData.query.metadataId}
					/>
				) : loaderData.query.metadataGroupId ? (
					<input
						type="hidden"
						name="metadataGroupId"
						value={loaderData.query.metadataGroupId}
					/>
				) : loaderData.query.personId ? (
					<input
						type="hidden"
						name="personId"
						value={loaderData.query.personId}
					/>
				) : undefined}
				<Stack>
					<Title order={3}>Reviewing "{loaderData.query.title}"</Title>
					<Flex align="center" gap="xl">
						{match(loaderData.userPreferences.general.reviewScale)
							.with(UserReviewScale.OutOfFive, () => (
								<Flex gap="sm" mt="lg">
									<Input.Label>Rating:</Input.Label>
									<Rating
										defaultValue={
											loaderData.existingReview?.rating
												? Number(loaderData.existingReview.rating)
												: undefined
										}
										fractions={2}
									/>
								</Flex>
							))
							.with(UserReviewScale.OutOfHundred, () => (
								<NumberInput
									label="Rating"
									min={0}
									max={100}
									step={1}
									w="40%"
									hideControls
									rightSection={<IconPercentage size={16} />}
									defaultValue={
										loaderData.existingReview?.rating
											? Number(loaderData.existingReview.rating)
											: undefined
									}
								/>
							))
							.exhaustive()}
						<Checkbox label="This review is a spoiler" mt="lg" />
					</Flex>
					{loaderData.query.isShow ? (
						<Flex gap="md">
							<NumberInput
								label="Season"
								hideControls
								defaultValue={
									loaderData.existingReview?.showSeason
										? Number(loaderData.existingReview.showSeason)
										: undefined
								}
							/>
							<NumberInput
								label="Episode"
								hideControls
								defaultValue={
									loaderData.existingReview?.showEpisode
										? Number(loaderData.existingReview.showEpisode)
										: undefined
								}
							/>
						</Flex>
					) : undefined}
					{loaderData.query.isPodcast ? (
						<Flex gap="md">
							<NumberInput
								label="Episode"
								hideControls
								defaultValue={
									loaderData.existingReview?.podcastEpisode
										? Number(loaderData.existingReview.podcastEpisode)
										: undefined
								}
							/>
						</Flex>
					) : undefined}
					<Textarea
						label="Review"
						description="Markdown is supported"
						autoFocus
						minRows={10}
						autosize
						defaultValue={loaderData.existingReview?.text ?? undefined}
					/>
					<Box>
						<Input.Label>Visibility</Input.Label>
						<SegmentedControl
							fullWidth
							data={[
								{
									label: Visibility.Public,
									value: Visibility.Public,
								},
								{
									label: Visibility.Private,
									value: Visibility.Private,
								},
							]}
							defaultValue={
								loaderData.existingReview?.visibility ?? Visibility.Public
							}
						/>
					</Box>
					<Button mt="md" type="submit" w="100%">
						{loaderData.query.existingReviewId ? "Update" : "Submit"}
					</Button>
					{loaderData.query.existingReviewId ? (
						<Button
							w="100%"
							color="red"
							name="reviewId"
							value={loaderData.query.existingReviewId}
							type="submit"
						>
							Delete
						</Button>
					) : undefined}
				</Stack>
			</Box>
		</Container>
	);
}
