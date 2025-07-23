import { Checkbox, Select } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const ShowForm = ({ metadataDetails }: MediaFormProps) => {
	const { metadataToUpdate, setMetadataToUpdate } = useMetadataProgressUpdate();
	if (metadataDetails.lot !== MediaLot.Show || !metadataToUpdate) return null;

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
					setMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.showSeasonNumber = Number(v);
						}),
					);
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
					setMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.showEpisodeNumber = Number(v);
						}),
					);
				}}
				data={
					metadataDetails.showSpecifics?.seasons
						.find((s) => s.seasonNumber === metadataToUpdate.showSeasonNumber)
						?.episodes.map((e) => ({
							label: `${e.episodeNumber}. ${e.name.toString()}`,
							value: e.episodeNumber.toString(),
						})) || []
				}
			/>
			<Checkbox
				size="xs"
				label="Mark all unseen episodes before this as seen"
				defaultChecked={metadataToUpdate.showAllEpisodesBefore}
				onChange={(e) => {
					setMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.showAllEpisodesBefore = e.target.checked;
						}),
					);
				}}
			/>
		</>
	);
};
