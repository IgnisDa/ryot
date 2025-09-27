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
import { useState } from "react";
import { match } from "ts-pattern";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useDeployBulkMetadataProgressUpdateMutation } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MetadataInProgressFormProps } from "./utils/form-types";

export const MetadataInProgressUpdateForm = ({
	onSubmit,
	inProgress,
	metadataDetails,
}: MetadataInProgressFormProps) => {
	const { metadataToUpdate } = useMetadataProgressUpdate();
	const deployBulkMetadataProgressUpdate =
		useDeployBulkMetadataProgressUpdateMutation(metadataDetails.title);

	if (!metadataToUpdate) return null;

	const total =
		metadataDetails.audioBookSpecifics?.runtime ||
		metadataDetails.bookSpecifics?.pages ||
		metadataDetails.movieSpecifics?.runtime ||
		metadataDetails.mangaSpecifics?.chapters ||
		metadataDetails.animeSpecifics?.episodes ||
		metadataDetails.visualNovelSpecifics?.length;
	const progress = Number(inProgress.progress);
	const [value, setValue] = useState<number | undefined>(progress);

	const [updateIcon, text] = match(metadataDetails.lot)
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
		<Stack>
			<Stack gap="xs">
				<Text size="xs" c="dimmed">
					Last updated on {dayjsLib(inProgress.lastUpdatedOn).format("LLL")}
				</Text>
				<Group>
					<Slider
						min={0}
						step={1}
						max={100}
						value={value}
						onChange={setValue}
						style={{ flexGrow: 1 }}
						showLabelOnHover={false}
					/>
					<NumberInput
						w="20%"
						min={0}
						step={1}
						max={100}
						size="xs"
						hideControls
						value={value}
						onFocus={(e) => e.target.select()}
						rightSection={<IconPercentage size={16} />}
						onChange={(v) => {
							if (isNumber(v)) setValue(v);
							else setValue(undefined);
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
							defaultValue={((Number(total) || 1) * (value || 1)) / 100}
							onChange={(v) => {
								const value = (Number(v) / (Number(total) || 1)) * 100;
								setValue(value);
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
				onClick={async () => {
					await deployBulkMetadataProgressUpdate.mutateAsync([
						{
							metadataId: metadataToUpdate.metadataId,
							change: { changeLatestInProgress: value?.toString() },
						},
					]);
					onSubmit();
				}}
			>
				Update
			</Button>
		</Stack>
	);
};
