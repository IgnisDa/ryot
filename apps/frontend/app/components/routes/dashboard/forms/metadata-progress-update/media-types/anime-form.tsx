import { Checkbox, NumberInput, rem, Text } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataDetails } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const AnimeForm = (props: MediaFormProps) => {
	const { metadataToUpdate, updateMetadataToUpdate } =
		useMetadataProgressUpdate();
	const [{ data: metadataDetails }] = useMetadataDetails(props.metadataId);
	if (
		!metadataDetails ||
		metadataDetails.lot !== MediaLot.Anime ||
		!metadataToUpdate
	)
		return null;

	const totalEpisodes = metadataDetails.animeSpecifics?.episodes;

	return (
		<>
			<NumberInput
				required
				size="xs"
				hideControls
				label="Episode"
				rightSectionWidth={rem(60)}
				value={metadataToUpdate.animeEpisodeNumber?.toString()}
				rightSection={
					totalEpisodes ? (
						<Text size="xs">Total: {totalEpisodes}</Text>
					) : undefined
				}
				onChange={(e) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						animeEpisodeNumber: Number(e),
					});
				}}
			/>
			<Checkbox
				size="xs"
				label="Mark all unseen episodes before this as watched"
				checked={metadataToUpdate.animeAllEpisodesBefore || false}
				onChange={(e) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						animeAllEpisodesBefore: e.target.checked,
					});
				}}
			/>
		</>
	);
};
