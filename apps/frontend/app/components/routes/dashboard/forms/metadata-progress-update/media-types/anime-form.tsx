import { Checkbox, NumberInput } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const AnimeForm = (props: MediaFormProps) => {
	const { metadataToUpdate, setMetadataToUpdate } = useMetadataProgressUpdate();
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
					setMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.animeEpisodeNumber = Number(e);
						}),
					);
				}}
			/>
			<Checkbox
				size="xs"
				label="Mark all unseen episodes before this as watched"
				defaultChecked={metadataToUpdate.animeAllEpisodesBefore}
				onChange={(e) => {
					setMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.animeAllEpisodesBefore = e.target.checked;
						}),
					);
				}}
			/>
		</>
	);
};
