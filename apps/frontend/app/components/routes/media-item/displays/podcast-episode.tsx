import { Box, Button, Divider } from "@mantine/core";
import {
	EntityLot,
	EntityTranslationVariant,
	type PodcastEpisode,
} from "@ryot/generated/graphql/backend/graphql";
import { useMemo } from "react";
import { useTranslationValue } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { MetadataDetails, UserMetadataDetails } from "../types";
import { DisplaySeasonOrEpisodeDetails } from "./season-episode-details";

export const DisplayPodcastEpisode = (props: {
	index: number;
	episode: PodcastEpisode;
	metadataDetails: MetadataDetails;
	podcastProgress: UserMetadataDetails["podcastProgress"];
}) => {
	const { initializeMetadataToUpdate } = useMetadataProgressUpdate();
	const numTimesEpisodeSeen =
		props.podcastProgress?.[props.index]?.timesSeen || 0;
	const podcastExtraInformation = useMemo(
		() => ({ episode: props.episode.number }),
		[props.episode.number],
	);
	const episodeTitleTranslation = useTranslationValue({
		podcastExtraInformation,
		entityLot: EntityLot.Metadata,
		entityId: props.metadataDetails.id,
		variant: EntityTranslationVariant.Title,
	});
	const episodeDescriptionTranslation = useTranslationValue({
		podcastExtraInformation,
		entityLot: EntityLot.Metadata,
		entityId: props.metadataDetails.id,
		variant: EntityTranslationVariant.Description,
	});

	return (
		<Box my={props.index !== 0 ? "md" : undefined}>
			{props.index !== 0 ? <Divider mb="md" /> : null}
			<DisplaySeasonOrEpisodeDetails
				{...props.episode}
				displayIndicator={numTimesEpisodeSeen}
				publishDate={props.episode.publishDate}
				posterImages={[props.episode.thumbnail || ""]}
				name={episodeTitleTranslation ?? props.episode.title}
				overview={episodeDescriptionTranslation ?? props.episode.overview}
			>
				<Button
					color="blue"
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					onClick={() => {
						initializeMetadataToUpdate({
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
