import { Checkbox, Select } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataDetails } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const ShowForm = (props: MediaFormProps) => {
	const { metadataToUpdate, updateMetadataToUpdate } =
		useMetadataProgressUpdate();
	const [{ data: metadataDetails }] = useMetadataDetails(props.metadataId);
	if (
		!metadataDetails ||
		metadataDetails.lot !== MediaLot.Show ||
		!metadataToUpdate
	)
		return null;

	return (
		<>
			<Select
				required
				size="xs"
				searchable
				limit={50}
				label="Season"
				value={metadataToUpdate.showSeasonNumber?.toString()}
				data={metadataDetails.showSpecifics?.seasons.map((s) => ({
					label: `${s.seasonNumber}. ${s.name.toString()}`,
					value: s.seasonNumber.toString(),
				}))}
				onChange={(v) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						showSeasonNumber: Number(v),
					});
				}}
			/>
			<Select
				required
				size="xs"
				limit={50}
				searchable
				label="Episode"
				value={metadataToUpdate.showEpisodeNumber?.toString()}
				onChange={(v) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						showEpisodeNumber: Number(v),
					});
				}}
				data={
					metadataDetails.showSpecifics?.seasons
						.find((s) => s.seasonNumber === metadataToUpdate.showSeasonNumber)
						?.episodes.map((e) => ({
							value: e.episodeNumber.toString(),
							label: `${e.episodeNumber}. ${e.name.toString()}`,
						})) || []
				}
			/>
			<Checkbox
				size="xs"
				label="Mark all unseen episodes before this"
				checked={metadataToUpdate.showAllEpisodesBefore || false}
				onChange={(e) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						showAllEpisodesBefore: e.target.checked,
					});
				}}
			/>
			<Checkbox
				size="xs"
				label="Mark all unseen episodes in this season before this"
				checked={metadataToUpdate.showSeasonEpisodesBefore || false}
				onChange={(e) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						showSeasonEpisodesBefore: e.target.checked,
					});
				}}
			/>
		</>
	);
};
