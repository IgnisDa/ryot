import { Box, Button } from "@mantine/core";
import { EntityTranslationVariant } from "@ryot/generated/graphql/backend/graphql";
import { sum } from "@ryot/ts-utils";
import { useMemo } from "react";
import { useMetadataDetails, useUserMetadataDetails } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { Season } from "../types";
import { DisplaySeasonOrEpisodeDetails } from "./season-episode-details";

const getShowSeasonDisplayName = (season: Season, title: string) =>
	`${season.seasonNumber}. ${title}`;

export const DisplayShowSeason = (props: {
	season: Season;
	seasonIdx: number;
	metadataId: string;
	openSeasonModal: () => void;
}) => {
	const { initializeMetadataToUpdate } = useMetadataProgressUpdate();
	const [, , useMetadataTranslationValue] = useMetadataDetails(
		props.metadataId,
	);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);

	const seasonProgress = userMetadataDetails?.showProgress?.[props.seasonIdx];
	const numTimesSeen = seasonProgress?.timesSeen || 0;
	const isSeen = numTimesSeen > 0;
	const showExtraInformation = useMemo(
		() => ({ season: props.season.seasonNumber }),
		[props.season.seasonNumber],
	);
	const seasonTitleTranslation = useMetadataTranslationValue({
		showExtraInformation,
		variant: EntityTranslationVariant.Title,
	});
	const seasonDescriptionTranslation = useMetadataTranslationValue({
		showExtraInformation,
		variant: EntityTranslationVariant.Description,
	});

	return (
		<Box my={props.seasonIdx !== 0 ? "md" : undefined}>
			<DisplaySeasonOrEpisodeDetails
				{...props.season}
				displayIndicator={numTimesSeen}
				numEpisodes={props.season.episodes.length}
				onNameClick={() => props.openSeasonModal()}
				overview={seasonDescriptionTranslation ?? props.season.overview}
				endDate={props.season.episodes.at(-1)?.publishDate}
				startDate={props.season.episodes.at(0)?.publishDate}
				runtime={sum(props.season.episodes.map((e) => e.runtime || 0))}
				name={getShowSeasonDisplayName(
					props.season,
					seasonTitleTranslation ?? props.season.name,
				)}
			>
				{props.season.episodes.length > 0 ? (
					<Button
						size="xs"
						color="blue"
						variant={isSeen ? "default" : "outline"}
						onClick={() => {
							initializeMetadataToUpdate({
								metadataId: props.metadataId,
								showSeasonNumber: props.season.seasonNumber,
								showEpisodeNumber: props.season.episodes.at(-1)?.episodeNumber,
							});
						}}
					>
						{isSeen ? "Watch again" : "Mark as seen"}
					</Button>
				) : null}
			</DisplaySeasonOrEpisodeDetails>
		</Box>
	);
};
