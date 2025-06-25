import { Box, Button } from "@mantine/core";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MetadataDetails, Season, SeasonProgress } from "../types";
import { DisplaySeasonOrEpisodeDetails } from "./season-episode-details";

export const DisplayShowEpisode = (props: {
	seasonIdx: number;
	episodeIdx: number;
	seasonNumber: number;
	beforeOpenModal?: () => void;
	metadataDetails: MetadataDetails;
	episode: Season["episodes"][number];
	episodeProgress?: SeasonProgress["episodes"][number];
}) => {
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const numTimesEpisodeSeen = props.episodeProgress?.timesSeen || 0;

	return (
		<Box my="lg" ml="md">
			<DisplaySeasonOrEpisodeDetails
				{...props.episode}
				key={props.episode.episodeNumber}
				name={`${props.episode.episodeNumber}. ${props.episode.name}`}
				publishDate={props.episode.publishDate}
				displayIndicator={numTimesEpisodeSeen}
			>
				<Button
					size="xs"
					color="blue"
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					onClick={() => {
						if (props.beforeOpenModal) props.beforeOpenModal();
						setMetadataToUpdate({
							metadataId: props.metadataDetails.id,
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
