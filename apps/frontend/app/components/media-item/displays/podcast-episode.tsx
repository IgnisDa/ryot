import { Box, Button, Divider } from "@mantine/core";
import type { PodcastEpisode } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MetadataDetails, UserMetadataDetails } from "../types";
import { DisplaySeasonOrEpisodeDetails } from "./season-episode-details";

export const DisplayPodcastEpisode = (props: {
	index: number;
	episode: PodcastEpisode;
	metadataDetails: MetadataDetails;
	podcastProgress: UserMetadataDetails["podcastProgress"];
}) => {
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const numTimesEpisodeSeen =
		props.podcastProgress?.[props.index]?.timesSeen || 0;

	return (
		<Box my={props.index !== 0 ? "md" : undefined}>
			{props.index !== 0 ? <Divider mb="md" /> : null}
			<DisplaySeasonOrEpisodeDetails
				{...props.episode}
				name={props.episode.title}
				displayIndicator={numTimesEpisodeSeen}
				publishDate={props.episode.publishDate}
				posterImages={[props.episode.thumbnail || ""]}
			>
				<Button
					color="blue"
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					onClick={() => {
						setMetadataToUpdate({
							metadataId: props.metadataDetails.id,
							podcastEpisodeNumber: props.episode.number,
						});
					}}
				>
					{numTimesEpisodeSeen > 0 ? "Re-listen this" : "Mark as listened"}
				</Button>
			</DisplaySeasonOrEpisodeDetails>
		</Box>
	);
};
