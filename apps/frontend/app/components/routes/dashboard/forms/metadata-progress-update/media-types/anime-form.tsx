import { Checkbox, NumberInput } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const AnimeForm = (props: MediaFormProps) => {
	const { metadataToUpdate, updateMetadataToUpdate } =
		useMetadataProgressUpdate();
	if (props.metadataDetails.lot !== MediaLot.Anime || !metadataToUpdate)
		return null;

	return (
		<>
			<NumberInput
				required
				size="xs"
				hideControls
				label="Episode"
				value={metadataToUpdate.animeEpisodeNumber?.toString()}
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
