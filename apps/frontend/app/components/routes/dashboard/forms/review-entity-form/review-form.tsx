import {
	Box,
	Button,
	Checkbox,
	Flex,
	Input,
	SegmentedControl,
	Stack,
	Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
	EntityLot,
	MediaLot,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { useMetadataDetails, useUserPreferences } from "~/lib/shared/hooks";
import { useReviewEntity } from "~/lib/state/media";
import { AnimeInputs } from "./anime-inputs";
import { type ReviewFormValues, initializeFormValues } from "./helpers";
import { MangaInputs } from "./manga-inputs";
import { PodcastInputs } from "./podcast-inputs";
import { RatingInput } from "./rating-input";
import { ShowInputs } from "./show-inputs";
import { useReviewMutation } from "./use-review-mutation";

export const ReviewEntityForm = (props: {
	closeReviewEntityModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
	const [entityToReview] = useReviewEntity();
	const { data: metadataDetails } = useMetadataDetails(
		entityToReview?.entityId,
		entityToReview?.entityLot === EntityLot.Metadata,
	);

	const form = useForm<ReviewFormValues>({
		mode: "uncontrolled",
		initialValues: initializeFormValues(entityToReview),
	});

	const reviewMutation = useReviewMutation({
		entityToReview: entityToReview,
		closeModal: props.closeReviewEntityModal,
	});

	if (!entityToReview) return null;

	return (
		<Stack>
			<Flex align="center" gap="xl">
				<RatingInput
					form={form}
					reviewScale={userPreferences.general.reviewScale}
				/>
				<Checkbox
					mt="lg"
					label="This review is a spoiler"
					{...form.getInputProps("isSpoiler", { type: "checkbox" })}
				/>
			</Flex>
			{entityToReview.metadataLot === MediaLot.Show && (
				<ShowInputs form={form} metadataDetails={metadataDetails} />
			)}
			{entityToReview.metadataLot === MediaLot.Podcast && (
				<PodcastInputs form={form} metadataDetails={metadataDetails} />
			)}
			{entityToReview.metadataLot === MediaLot.Anime && (
				<AnimeInputs form={form} />
			)}
			{entityToReview.metadataLot === MediaLot.Manga && (
				<MangaInputs form={form} />
			)}
			<Textarea
				autosize
				autoFocus
				minRows={10}
				maxRows={20}
				label="Review"
				description="Markdown is supported"
				{...form.getInputProps("text")}
			/>
			<Box>
				<Input.Label>Visibility</Input.Label>
				<SegmentedControl
					fullWidth
					value={form.getValues().visibility || Visibility.Public}
					data={Object.entries(Visibility).map(([k, v]) => ({
						label: changeCase(k),
						value: v,
					}))}
					onChange={(v) => form.setFieldValue("visibility", v as Visibility)}
				/>
			</Box>
			<Button
				mt="md"
				w="100%"
				loading={reviewMutation.isPending}
				onClick={async () => {
					const validation = form.validate();
					if (validation.hasErrors) return;
					await reviewMutation.mutateAsync(form.getValues());
				}}
			>
				{entityToReview.existingReview?.id ? "Update" : "Submit"}
			</Button>
		</Stack>
	);
};
