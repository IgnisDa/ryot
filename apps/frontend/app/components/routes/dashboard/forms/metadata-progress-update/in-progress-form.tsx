import {
	Button,
	Flex,
	Group,
	NumberInput,
	Slider,
	Stack,
	Text,
} from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { isNumber } from "@ryot/ts-utils";
import {
	IconBook,
	IconBrandPagekit,
	IconClock,
	IconDeviceTv,
	IconPercentage,
} from "@tabler/icons-react";
import { match } from "ts-pattern";
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useDeployBulkMetadataProgressUpdateMutation } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MetadataInProgressFormProps } from "./utils/form-types";

export const MetadataInProgressUpdateForm = (
	props: MetadataInProgressFormProps,
) => {
	const { metadataToUpdate } = useMetadataProgressUpdate();
	const deployBulkMetadataProgressUpdate =
		useDeployBulkMetadataProgressUpdateMutation(props.metadataDetails.title);

	const form = useSavedForm<{ progress: number }>({
		storageKeyPrefix: "MetadataInProgressUpdateForm",
		initialValues: { progress: Number(props.inProgress.progress) },
		validate: {
			progress: (value) => {
				if (value < 0 || value > 100)
					return "Progress must be between 0 and 100";
				return null;
			},
		},
	});

	if (!metadataToUpdate) return null;

	const total =
		props.metadataDetails.bookSpecifics?.pages ||
		props.metadataDetails.movieSpecifics?.runtime ||
		props.metadataDetails.mangaSpecifics?.chapters ||
		props.metadataDetails.animeSpecifics?.episodes ||
		props.metadataDetails.audioBookSpecifics?.runtime ||
		props.metadataDetails.visualNovelSpecifics?.length;

	const [updateIcon, text] = match(props.metadataDetails.lot)
		.with(MediaLot.Book, () => [<IconBook size={24} key="element" />, "Pages"])
		.with(MediaLot.Anime, () => [
			<IconDeviceTv size={24} key="element" />,
			"Episodes",
		])
		.with(MediaLot.Manga, () => [
			<IconBrandPagekit size={24} key="element" />,
			"Chapters",
		])
		.with(MediaLot.Movie, MediaLot.VisualNovel, MediaLot.AudioBook, () => [
			<IconClock size={24} key="element" />,
			"Minutes",
		])
		.otherwise(() => [null, null]);

	return (
		<form
			onSubmit={form.onSubmit(async (values) => {
				await deployBulkMetadataProgressUpdate.mutateAsync([
					{
						metadataId: metadataToUpdate.metadataId,
						change: { changeLatestInProgress: values.progress.toString() },
					},
				]);
				form.clearSavedState();
				props.onSubmit();
			})}
		>
			<Stack>
				<Stack gap="xs">
					<Text size="xs" c="dimmed">
						Last updated on{" "}
						{dayjsLib(props.inProgress.lastUpdatedOn).format("LLL")}
					</Text>
					<Group>
						<Slider
							min={0}
							step={1}
							max={100}
							style={{ flexGrow: 1 }}
							showLabelOnHover={false}
							value={form.values.progress}
							onChange={(value) => form.setFieldValue("progress", value)}
						/>
						<NumberInput
							w="20%"
							min={0}
							step={1}
							max={100}
							size="xs"
							hideControls
							value={form.values.progress}
							onFocus={(e) => e.target.select()}
							rightSection={<IconPercentage size={16} />}
							onChange={(v) => {
								if (isNumber(v)) form.setFieldValue("progress", v);
							}}
						/>
					</Group>
				</Stack>
				{total ? (
					<>
						<Text ta="center" fw="bold">
							OR
						</Text>
						<Flex align="center" gap="xs">
							<NumberInput
								min={0}
								step={1}
								flex={1}
								size="xs"
								hideControls
								leftSection={updateIcon}
								max={Number(total)}
								onFocus={(e) => e.target.select()}
								value={
									((Number(total) || 1) * (form.values.progress || 1)) / 100
								}
								onChange={(v) => {
									const value = (Number(v) / (Number(total) || 1)) * 100;
									form.setFieldValue("progress", value);
								}}
							/>
							<Text>{text}</Text>
						</Flex>
					</>
				) : null}
				<Button
					size="xs"
					type="submit"
					variant="outline"
					loading={deployBulkMetadataProgressUpdate.isPending}
				>
					Update
				</Button>
			</Stack>
		</form>
	);
};
