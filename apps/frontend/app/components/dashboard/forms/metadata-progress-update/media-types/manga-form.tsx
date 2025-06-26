import { Checkbox, Group, Input, NumberInput, Text } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import type { MediaFormProps } from "../utils/form-types";

export const MangaForm = ({
	metadataDetails,
	metadataToUpdate,
	setMetadataToUpdate,
}: MediaFormProps) => {
	if (metadataDetails.lot !== MediaLot.Manga) return null;

	return (
		<>
			<Input.Wrapper
				required
				label="Enter either the chapter number or the volume number"
			>
				<Group wrap="nowrap">
					<NumberInput
						hideControls
						description="Chapter"
						value={metadataToUpdate.mangaChapterNumber?.toString()}
						onChange={(e) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.mangaChapterNumber =
										e === "" ? undefined : Number(e).toString();
								}),
							);
						}}
					/>
					<Text ta="center" fw="bold" mt="sm">
						OR
					</Text>
					<NumberInput
						hideControls
						description="Volume"
						value={metadataToUpdate.mangaVolumeNumber?.toString()}
						onChange={(e) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.mangaVolumeNumber = e === "" ? undefined : Number(e);
								}),
							);
						}}
					/>
				</Group>
			</Input.Wrapper>
			<Checkbox
				label="Mark all unread volumes/chapters before this as watched"
				defaultChecked={metadataToUpdate.mangaAllChaptersOrVolumesBefore}
				onChange={(e) => {
					setMetadataToUpdate(
						produce(metadataToUpdate, (draft) => {
							draft.mangaAllChaptersOrVolumesBefore = e.target.checked;
						}),
					);
				}}
			/>
		</>
	);
};
