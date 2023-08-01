import type { NextPageWithLayout } from "../../_app";
import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Button,
	Checkbox,
	Container,
	Flex,
	Input,
	NumberInput,
	SegmentedControl,
	Stack,
	Textarea,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import {
	DeleteReviewDocument,
	type DeleteReviewMutationVariables,
	MediaDetailsDocument,
	PostReviewDocument,
	type PostReviewMutationVariables,
	ReviewByIdDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { IconPercentage } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import invariant from "tiny-invariant";
import { withQuery } from "ufo";
import { z } from "zod";

const numberOrUndefined = z.any().optional();

const formSchema = z.object({
	rating: z.preprocess(Number, z.number().min(0).max(100)).optional(),
	text: z.string().optional(),
	visibility: z.nativeEnum(Visibility).default(Visibility.Public).optional(),
	spoiler: z.boolean().optional(),
	showSeasonNumber: numberOrUndefined,
	showEpisodeNumber: numberOrUndefined,
	podcastEpisodeNumber: numberOrUndefined,
});
type FormSchema = z.infer<typeof formSchema>;

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const metadataId = parseInt(router.query.id?.toString() || "0");
	const reviewId = Number(router.query.reviewId?.toString()) || null;
	const showSeasonNumber = Number(router.query.showSeasonNumber) || undefined;
	const showEpisodeNumber = Number(router.query.showEpisodeNumber) || undefined;
	const podcastEpisodeNumber =
		Number(router.query.podcastEpisodeNumber) || undefined;

	const form = useForm<FormSchema>({
		validate: zodResolver(formSchema),
		initialValues: {
			showSeasonNumber,
			showEpisodeNumber,
			podcastEpisodeNumber,
		},
	});

	const mediaDetails = useQuery({
		queryKey: ["mediaDetails", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(MediaDetailsDocument, {
				metadataId: metadataId,
			});
			return mediaDetails;
		},
		staleTime: Infinity,
	});

	useQuery({
		enabled: reviewId !== undefined,
		queryKey: ["reviewDetails", reviewId],
		queryFn: async () => {
			invariant(reviewId, "Can not get review details");
			const { reviewById } = await gqlClient.request(ReviewByIdDocument, {
				reviewId,
			});
			return reviewById;
		},
		onSuccess: (data) => {
			form.setValues({
				rating: Number(data?.rating) ?? undefined,
				text: data?.text ?? undefined,
				visibility: data?.visibility,
				spoiler: data?.spoiler,
				podcastEpisodeNumber: data?.podcastEpisode ?? undefined,
				showSeasonNumber: data.showSeason ?? undefined,
				showEpisodeNumber: data?.showEpisode ?? undefined,
			});
			form.resetDirty();
		},
		staleTime: Infinity,
	});

	const postReview = useMutation({
		mutationFn: async (variables: PostReviewMutationVariables) => {
			if (variables.input.podcastEpisodeNumber?.toString() === "")
				variables.input.podcastEpisodeNumber = undefined;
			if (variables.input.showSeasonNumber?.toString() === "")
				variables.input.showSeasonNumber = undefined;
			if (variables.input.showEpisodeNumber?.toString() === "")
				variables.input.showEpisodeNumber = undefined;
			const { postReview } = await gqlClient.request(
				PostReviewDocument,
				variables,
			);
			return postReview;
		},
		onSuccess: () => {
			router.replace(
				withQuery(APP_ROUTES.media.individualMediaItem.details, {
					id: metadataId,
				}),
			);
		},
	});

	const deleteReview = useMutation({
		mutationFn: async (variables: DeleteReviewMutationVariables) => {
			const { deleteReview } = await gqlClient.request(
				DeleteReviewDocument,
				variables,
			);
			return deleteReview;
		},
		onSuccess: () => {
			router.push(
				withQuery(APP_ROUTES.media.individualMediaItem.details, {
					id: metadataId,
				}),
			);
		},
	});

	const title = mediaDetails.data?.title;

	return mediaDetails.data && title ? (
		<>
			<Head>
				<title>Post Review | Ryot</title>
			</Head>
			<Container size={"xs"}>
				<Box
					component="form"
					onSubmit={form.onSubmit((values) => {
						postReview.mutate({
							input: {
								metadataId,
								...values,
								reviewId,
							},
						});
					})}
				>
					<Stack>
						<Title order={3}>Reviewing "{title}"</Title>
						<Flex align={"center"} gap="xl">
							<NumberInput
								label="Rating"
								{...form.getInputProps("rating")}
								min={0}
								max={100}
								step={1}
								w={"40%"}
								type="number"
								hideControls
								rightSection={<IconPercentage size="1rem" />}
							/>
							<Checkbox
								label="This review is a spoiler"
								mt="lg"
								{...form.getInputProps("spoiler", { type: "checkbox" })}
							/>
						</Flex>
						{mediaDetails.data.showSpecifics ? (
							<Flex gap="md">
								<NumberInput
									label="Season"
									{...form.getInputProps("showSeasonNumber")}
									hideControls
								/>
								<NumberInput
									label="Episode"
									{...form.getInputProps("showEpisodeNumber")}
									hideControls
								/>
							</Flex>
						) : null}
						{mediaDetails.data.podcastSpecifics ? (
							<Flex gap="md">
								<NumberInput
									label="Episode"
									{...form.getInputProps("podcastEpisodeNumber")}
									hideControls
								/>
							</Flex>
						) : null}
						<Textarea
							label="Review"
							{...form.getInputProps("text")}
							autoFocus
							minRows={10}
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
								{...form.getInputProps("visibility")}
							/>
						</Box>
						<Button
							mt="md"
							type="submit"
							loading={postReview.isLoading}
							w="100%"
						>
							{reviewId ? "Update" : "Submit"}
						</Button>
						{reviewId ? (
							<Button
								loading={deleteReview.isLoading}
								w="100%"
								color="red"
								onClick={() => {
									const yes = confirm(
										"Are you sure you want to delete this review?",
									);
									if (yes) deleteReview.mutate({ reviewId });
								}}
							>
								Delete
							</Button>
						) : null}
					</Stack>
				</Box>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
