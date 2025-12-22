import { Checkbox, Group, Input, NumberInput, Text, rem } from "@mantine/core";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MediaFormProps } from "../utils/form-types";

export const MangaForm = (props: MediaFormProps) => {
	const { metadataToUpdate, updateMetadataToUpdate } =
		useMetadataProgressUpdate();
	if (props.metadataDetails.lot !== MediaLot.Manga || !metadataToUpdate)
		return null;

	const totalVolumes = props.metadataDetails.mangaSpecifics?.volumes;
	const totalChapters = props.metadataDetails.mangaSpecifics?.chapters;

	return (
		<>
			<Input.Wrapper
				required
				label="Enter either the chapter number or the volume number"
			>
				<Group wrap="nowrap" mt={4}>
					<NumberInput
						size="xs"
						hideControls
						description="Chapter"
						rightSectionWidth={rem(60)}
						value={metadataToUpdate.mangaChapterNumber?.toString()}
						rightSection={
							totalChapters ? (
								<Text size="xs">Total: {totalChapters}</Text>
							) : undefined
						}
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
						rightSectionWidth={rem(60)}
						value={metadataToUpdate.mangaVolumeNumber?.toString()}
						rightSection={
							totalVolumes ? (
								<Text size="xs">Total: {totalVolumes}</Text>
							) : undefined
						}
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
