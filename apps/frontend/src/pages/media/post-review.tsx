import { APP_ROUTES } from "@/lib/constants";
import { useUserPreferences } from "@/lib/hooks/graphql";
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
	Rating,
	SegmentedControl,
	Stack,
	Textarea,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	CreatorDetailsDocument,
	DeleteReviewDocument,
	type DeleteReviewMutationVariables,
	MediaDetailsDocument,
	MetadataLot,
	PostReviewDocument,
	type PostReviewMutationVariables,
	ReviewDocument,
	UserReviewScale,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { IconPercentage } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import type { NextPageWithLayout } from "../_app";

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
	const metadataId = router.query.metadataId
		? parseInt(router.query.metadataId.toString())
		: undefined;
	const creatorId = router.query.creatorId
		? parseInt(router.query.creatorId.toString())
		: undefined;
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

	const userPreferences = useUserPreferences();

	const mediaDetails = useQuery({
		queryKey: ["mediaDetails", metadataId, creatorId],
		queryFn: async () => {
			if (metadataId) {
				const { mediaDetails } = await gqlClient.request(MediaDetailsDocument, {
					metadataId,
				});
				return {
					title: mediaDetails.title,
					isShow: mediaDetails.lot === MetadataLot.Show,
					isPodcast: mediaDetails.lot === MetadataLot.Podcast,
				};
			} else if (creatorId) {
				const { creatorDetails } = await gqlClient.request(
					CreatorDetailsDocument,
					{ creatorId },
				);
				return {
					title: creatorDetails.details.name,
					isShow: false,
					isPodcast: false,
				};
			}
			return { title: "", isShow: false, isPodcast: false };
		},
		staleTime: Infinity,
	});

	const onSuccess = () => {
		let url;
		if (router.query.next) url = router.query.next.toString();
		else if (metadataId)
			url = withQuery(APP_ROUTES.media.individualMediaItem.details, {
				id: metadataId,
			});
		else
			url = withQuery(APP_ROUTES.media.people.details, {
				id: creatorId,
			});
		router.replace(url);
	};

	useQuery({
		enabled: reviewId !== undefined,
		queryKey: ["reviewDetails", reviewId],
		queryFn: async () => {
			invariant(reviewId, "Can not get review details");
			const { review } = await gqlClient.request(ReviewDocument, {
				reviewId,
			});
			return review;
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
		onSuccess,
		// biome-ignore lint/suspicious/noExplicitAny: required
		onError: (e: any) => {
			notifications.show({
				message: e.response.errors[0].message,
				color: "red",
			});
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
		onSuccess,
	});

	const title = mediaDetails.data?.title;

	return userPreferences.data && mediaDetails.data && title ? (
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
								creatorId,
								...values,
								reviewId,
							},
						});
					})}
				>
					<Stack>
						<Title order={3}>Reviewing "{title}"</Title>
						<Flex align={"center"} gap="xl">
							{match(userPreferences.data.general.reviewScale)
								.with(UserReviewScale.OutOfFive, () => (
									<Flex gap="sm" mt={"lg"}>
										<Input.Label>Rating:</Input.Label>
										<Rating {...form.getInputProps("rating")} fractions={2} />
									</Flex>
								))
								.with(UserReviewScale.OutOfHundred, () => (
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
								))
								.exhaustive()}
							<Checkbox
								label="This review is a spoiler"
								mt="lg"
								{...form.getInputProps("spoiler", { type: "checkbox" })}
							/>
						</Flex>
						{mediaDetails.data.isShow ? (
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
						) : undefined}
						{mediaDetails.data.isPodcast ? (
							<Flex gap="md">
								<NumberInput
									label="Episode"
									{...form.getInputProps("podcastEpisodeNumber")}
									hideControls
								/>
							</Flex>
						) : undefined}
						<Textarea
							label="Review"
							description={"Markdown is supported"}
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
						) : undefined}
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
