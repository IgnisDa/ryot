import { Box, Button } from "@mantine/core";
import { EntityTranslationVariant } from "@ryot/generated/graphql/backend/graphql";
import { useMemo } from "react";
import { useMetadataTranslationValue } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { Season, SeasonProgress } from "../types";
import { DisplaySeasonOrEpisodeDetails } from "./season-episode-details";

export const DisplayShowEpisode = (props: {
	seasonIdx: number;
	episodeIdx: number;
	metadataId: string;
	seasonNumber: number;
	episode: Season["episodes"][number];
	episodeProgress?: SeasonProgress["episodes"][number];
}) => {
	const { initializeMetadataToUpdate } = useMetadataProgressUpdate();
	const numTimesEpisodeSeen = props.episodeProgress?.timesSeen || 0;
	const showExtraInformation = useMemo(
		() => ({
			season: props.seasonNumber,
			episode: props.episode.episodeNumber,
		}),
		[props.seasonNumber, props.episode.episodeNumber],
	);
	const episodeTitleTranslation = useMetadataTranslationValue({
		metadataId: props.metadataId,
		showExtraInformation,
		variant: EntityTranslationVariant.Title,
	});
	const episodeDescriptionTranslation = useMetadataTranslationValue({
		metadataId: props.metadataId,
		showExtraInformation,
		variant: EntityTranslationVariant.Description,
	});
	const episodeName = `${props.episode.episodeNumber}. ${
		episodeTitleTranslation ?? props.episode.name
	}`;

	return (
		<Box my="lg" ml="md">
			<DisplaySeasonOrEpisodeDetails
				{...props.episode}
				name={episodeName}
				key={props.episode.episodeNumber}
				displayIndicator={numTimesEpisodeSeen}
				publishDate={props.episode.publishDate}
				overview={episodeDescriptionTranslation ?? props.episode.overview}
			>
				<Button
					size="xs"
					color="blue"
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					onClick={() => {
						initializeMetadataToUpdate({
							metadataId: props.metadataId,
							showSeasonNumber: props.seasonNumber,
							showEpisodeNumber: props.episode.episodeNumber,
						});
					}}
				>
					{numTimesEpisodeSeen > 0 ? "Rewatch this" : "Mark as seen"}
				</Button>
			</DisplaySeasonOrEpisodeDetails>
		</Box>
	);
};
