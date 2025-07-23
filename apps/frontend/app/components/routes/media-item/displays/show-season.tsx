import { Box, Button } from "@mantine/core";
import { sum } from "@ryot/ts-utils";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import type { Season, UserMetadataDetails } from "../types";
import { DisplaySeasonOrEpisodeDetails } from "./season-episode-details";

const getShowSeasonDisplayName = (season: Season) =>
	`${season.seasonNumber}. ${season.name}`;

export const DisplayShowSeason = (props: {
	season: Season;
	seasonIdx: number;
	metadataId: string;
	openSeasonModal: () => void;
	userMetadataDetails: UserMetadataDetails;
}) => {
	const { setMetadataToUpdate } = useMetadataProgressUpdate();

	const seasonProgress =
		props.userMetadataDetails.showProgress?.[props.seasonIdx];
	const numTimesSeen = seasonProgress?.timesSeen || 0;
	const isSeen = numTimesSeen > 0;

	return (
		<Box my={props.seasonIdx !== 0 ? "md" : undefined}>
			<DisplaySeasonOrEpisodeDetails
				{...props.season}
				displayIndicator={numTimesSeen}
				numEpisodes={props.season.episodes.length}
				onNameClick={() => props.openSeasonModal()}
				name={getShowSeasonDisplayName(props.season)}
				endDate={props.season.episodes.at(-1)?.publishDate}
				startDate={props.season.episodes.at(0)?.publishDate}
				runtime={sum(props.season.episodes.map((e) => e.runtime || 0))}
			>
				{props.season.episodes.length > 0 ? (
					<Button
						size="xs"
						color="blue"
						variant={isSeen ? "default" : "outline"}
						onClick={() => {
							setMetadataToUpdate({
								showAllEpisodesBefore: true,
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
