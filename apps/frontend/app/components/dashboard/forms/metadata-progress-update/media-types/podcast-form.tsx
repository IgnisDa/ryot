import { Checkbox, Select, Text } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import type { MediaFormProps } from "../utils/form-types";

export const PodcastForm = ({
	metadataDetails,
	metadataToUpdate,
	setMetadataToUpdate,
}: MediaFormProps) => {
	if (metadataDetails.lot !== MediaLot.Podcast) return null;

	return (
		<>
			<Text fw="bold">Select episode</Text>
			<Select
				required
				limit={50}
				searchable
				label="Episode"
				value={metadataToUpdate.podcastEpisodeNumber?.toString()}
				data={metadataDetails.podcastSpecifics?.episodes.map((se) => ({
					label: se.title.toString(),
					value: se.number.toString(),
				}))}
				onChange={(v) => {
					setMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.podcastEpisodeNumber = Number(v);
						}),
					);
				}}
			/>
			<Checkbox
				label="Mark all unseen episodes before this as seen"
				defaultChecked={metadataToUpdate.podcastAllEpisodesBefore}
				onChange={(e) => {
					setMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.podcastAllEpisodesBefore = e.target.checked;
						}),
					);
				}}
			/>
		</>
	);
};
