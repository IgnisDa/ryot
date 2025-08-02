import { Paper, SegmentedControl, Select, Text } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import { ShowMarkingMode, useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const ShowForm = (props: MediaFormProps) => {
	const { metadataToUpdate, updateMetadataToUpdate } =
		useMetadataProgressUpdate();
	if (props.metadataDetails.lot !== MediaLot.Show || !metadataToUpdate)
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
				data={props.metadataDetails.showSpecifics?.seasons.map((s) => ({
					label: `${s.seasonNumber}. ${s.name.toString()}`,
					value: s.seasonNumber.toString(),
				}))}
				onChange={(v) => {
					updateMetadataToUpdate(
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
					updateMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.showEpisodeNumber = Number(v);
						}),
					);
				}}
				data={
					props.metadataDetails.showSpecifics?.seasons
						.find((s) => s.seasonNumber === metadataToUpdate.showSeasonNumber)
						?.episodes.map((e) => ({
							label: `${e.episodeNumber}. ${e.name.toString()}`,
							value: e.episodeNumber.toString(),
						})) || []
				}
			/>
			<Paper p="xs" withBorder>
				<SegmentedControl
					size="xs"
					fullWidth
					data={[
						{ label: "All", value: ShowMarkingMode.All },
						{ label: "Season", value: ShowMarkingMode.Season },
					]}
					value={metadataToUpdate.showMarkingMode || ShowMarkingMode.All}
					onChange={(value) => {
						updateMetadataToUpdate(
							produce(metadataToUpdate, (draft) => {
								draft.showMarkingMode = value as ShowMarkingMode;
							}),
						);
					}}
				/>
				<Text size="xs" c="dimmed" mt="xs">
					{metadataToUpdate.showMarkingMode === ShowMarkingMode.Season
						? "Mark all unseen episodes in this season before this"
						: "Mark all unseen episodes before this"}
				</Text>
			</Paper>
		</>
	);
};
