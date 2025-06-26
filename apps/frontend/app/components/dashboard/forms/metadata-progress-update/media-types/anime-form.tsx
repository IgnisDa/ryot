import { Checkbox, NumberInput } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import type { MediaFormProps } from "../utils/form-types";

export const AnimeForm = ({
	metadataDetails,
	metadataToUpdate,
	setMetadataToUpdate,
}: MediaFormProps) => {
	if (metadataDetails.lot !== MediaLot.Anime) return null;

	return (
		<>
			<NumberInput
				required
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
