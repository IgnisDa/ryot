import { Checkbox, Select, Text } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const PodcastForm = (props: MediaFormProps) => {
	const { metadataToUpdate, updateMetadataToUpdate } =
		useMetadataProgressUpdate();
	if (props.metadataDetails.lot !== MediaLot.Podcast || !metadataToUpdate)
		return null;

	return (
		<>
			<Text fw="bold">Select episode</Text>
			<Select
				required
				size="xs"
				limit={50}
				searchable
				label="Episode"
				value={metadataToUpdate.podcastEpisodeNumber?.toString()}
				data={props.metadataDetails.podcastSpecifics?.episodes.map((se) => ({
					label: se.title.toString(),
					value: se.number.toString(),
				}))}
				onChange={(v) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						podcastEpisodeNumber: Number(v),
					});
				}}
			/>
			<Checkbox
				size="xs"
				label="Mark all unseen episodes before this as seen"
				checked={metadataToUpdate.podcastAllEpisodesBefore || false}
				onChange={(e) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						podcastAllEpisodesBefore: e.target.checked,
					});
				}}
			/>
		</>
	);
};
