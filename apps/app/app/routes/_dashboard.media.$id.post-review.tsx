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
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	DeleteReviewDocument,
	PostReviewDocument,
	ReviewDocument,
	UserReviewScale,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { IconPercentage } from "@tabler/icons-react";
import { $path } from "remix-routes";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getUserPreferences } from "~/lib/graphql.server";
import { redirectWithToast } from "~/lib/toast.server";
import { ShowAndPodcastSchema, processSubmission } from "~/lib/utilities";

const searchParamsSchema = z
	.object({
		entityType: z.enum(["metadata", "metadataGroup", "collection", "person"]),
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
	return json({ query, existingReview, userPreferences, id });
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `Post review for ${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).query.title
			} | Ryot`,
		},
	];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	const submission = processSubmission(formData, reviewSchema);
	const redirectTo = submission.collectionId
		? $path("/media/collections/:id", { id: submission.collectionId })
		: submission.metadataGroupId
		? $path("/media/groups/:id", { id: submission.metadataGroupId })
		: submission.metadataId
		? $path("/media/item/:id", { id: submission.metadataId })
		: submission.personId
		? $path("/media/people/:id", { id: submission.personId })
		: "/";
	return namedAction(request, {
		create: async () => {
			await gqlClient.request(
				PostReviewDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return redirectWithToast(redirectTo, { message: "Review submitted" });
		},
		delete: async () => {
			invariant(submission.reviewId, "No reviewId provided");
			await gqlClient.request(
				DeleteReviewDocument,
				{ reviewId: submission.reviewId },
				await getAuthorizationHeader(request),
			);
			return redirectWithToast(redirectTo, { message: "Review deleted" });
		},
	});
};

const reviewSchema = z
	.object({
		rating: z.string().optional(),
		text: z.string().optional(),
		visibility: z.nativeEnum(Visibility).optional(),
		spoiler: zx.CheckboxAsString.optional(),
		metadataId: zx.IntAsString.optional(),
		metadataGroupId: zx.IntAsString.optional(),
		collectionId: zx.IntAsString.optional(),
		personId: zx.IntAsString.optional(),
		reviewId: zx.IntAsString.optional(),
	})
	.merge(ShowAndPodcastSchema);

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container size="xs">
			<Box component={Form} method="post">
				<input
					hidden
					name={
						loaderData.query.entityType === "metadata"
							? "metadataId"
							: loaderData.query.entityType === "metadataGroup"
							? "metadataGroupId"
							: loaderData.query.entityType === "collection"
							? "collectionId"
							: loaderData.query.entityType === "person"
							? "personId"
							: undefined
					}
					value={loaderData.id}
				/>
				{loaderData.query.existingReviewId ? (
					<input
						hidden
						name="reviewId"
						value={loaderData.query.existingReviewId}
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
										name="rating"
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
									name="rating"
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
						<Checkbox label="This review is a spoiler" mt="lg" name="spoiler" />
					</Flex>
					{loaderData.query.isShow ? (
						<Flex gap="md">
							<NumberInput
								label="Season"
								name="showSeasonNumber"
								hideControls
								defaultValue={
									loaderData.existingReview?.showSeason
										? Number(loaderData.existingReview.showSeason)
										: undefined
								}
							/>
							<NumberInput
								label="Episode"
								name="showEpisodeNumber"
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
								name="podcastEpisodeNumber"
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
						name="text"
						description="Markdown is supported"
						autoFocus
						minRows={10}
						maxRows={20}
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
							name="visibility"
						/>
					</Box>
					<Button mt="md" type="submit" w="100%" name="intent" value="create">
						{loaderData.query.existingReviewId ? "Update" : "Submit"}
					</Button>
					{loaderData.query.existingReviewId ? (
						<Button
							w="100%"
							color="red"
							name="intent"
							value="delete"
							type="submit"
							onClick={(e) => {
								if (
									!confirm(
										"Are you sure you want to delete this review? This action cannot be undone.",
									)
								)
									e.preventDefault();
							}}
						>
							Delete
						</Button>
					) : undefined}
				</Stack>
			</Box>
		</Container>
	);
}
