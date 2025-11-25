import { Checkbox, Group, Input, NumberInput, Text } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const MangaForm = (props: MediaFormProps) => {
	const { metadataToUpdate, updateMetadataToUpdate } =
		useMetadataProgressUpdate();
	if (props.metadataDetails.lot !== MediaLot.Manga || !metadataToUpdate)
		return null;

	return (
		<>
			<Input.Wrapper
				required
				label="Enter either the chapter number or the volume number"
			>
				<Group wrap="nowrap">
					<NumberInput
						size="xs"
						hideControls
						description="Chapter"
						value={metadataToUpdate.mangaChapterNumber?.toString()}
						onChange={(e) => {
							updateMetadataToUpdate({
								...metadataToUpdate,
								mangaChapterNumber: e === "" ? undefined : Number(e).toString(),
							});
						}}
					/>
					<Text ta="center" fw="bold" mt="sm">
						OR
					</Text>
					<NumberInput
						size="xs"
						hideControls
						description="Volume"
						value={metadataToUpdate.mangaVolumeNumber?.toString()}
						onChange={(e) => {
							updateMetadataToUpdate({
								...metadataToUpdate,
								mangaVolumeNumber: e === "" ? undefined : Number(e),
							});
						}}
					/>
				</Group>
			</Input.Wrapper>
			<Checkbox
				size="xs"
				label="Mark all unread volumes/chapters before this as watched"
				checked={metadataToUpdate.mangaAllChaptersOrVolumesBefore || false}
				onChange={(e) => {
					updateMetadataToUpdate({
						...metadataToUpdate,
						mangaAllChaptersOrVolumesBefore: e.target.checked,
					});
				}}
			/>
		</>
	);
};
