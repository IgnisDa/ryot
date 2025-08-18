import { Drawer, Stack, Text } from "@mantine/core";
import { isNumber } from "@ryot/ts-utils";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { DisplayShowEpisode } from "../displays/show-episode";
import type { MetadataDetails, Season, UserMetadataDetails } from "../types";

const getShowSeasonDisplayName = (season: Season) =>
	`${season.seasonNumber}. ${season.name}`;

export const DisplayShowSeasonEpisodesModal = (props: {
	metadataDetails: MetadataDetails;
	openedShowSeason: number | undefined;
	userMetadataDetails: UserMetadataDetails;
	setOpenedShowSeason: (v: number | undefined) => void;
}) => {
	const title = useMemo(() => {
		const showSpecifics = props.metadataDetails.showSpecifics;
		return isNumber(props.openedShowSeason) && showSpecifics
			? getShowSeasonDisplayName(showSpecifics.seasons[props.openedShowSeason])
			: "";
	}, [props.openedShowSeason]);

	return (
		<Drawer
			title={title}
			zIndex={150}
			opened={props.openedShowSeason !== undefined}
			onClose={() => props.setOpenedShowSeason(undefined)}
		>
			{isNumber(props.openedShowSeason) ? (
				<DisplayShowSeasonEpisodes
					metadataDetails={props.metadataDetails}
					openedShowSeason={props.openedShowSeason}
					userMetadataDetails={props.userMetadataDetails}
				/>
			) : null}
		</Drawer>
	);
};

const DisplayShowSeasonEpisodes = (props: {
	openedShowSeason: number;
	metadataDetails: MetadataDetails;
	userMetadataDetails: UserMetadataDetails;
}) => {
	const season =
		props.metadataDetails.showSpecifics?.seasons[props.openedShowSeason];
	const seasonProgress =
		props.userMetadataDetails.showProgress?.[props.openedShowSeason];

	return isNumber(props.openedShowSeason) && season ? (
		<Stack h={{ base: "80vh", md: "90vh" }} gap="xs">
			{season.episodes.length > 0 ? (
				<Virtuoso
					data={season.episodes}
					itemContent={(episodeIdx, episode) => (
						<DisplayShowEpisode
							episode={episode}
							episodeIdx={episodeIdx}
							seasonNumber={season.seasonNumber}
							seasonIdx={props.openedShowSeason}
							metadataDetails={props.metadataDetails}
							episodeProgress={seasonProgress?.episodes[episodeIdx]}
						/>
					)}
				/>
			) : (
				<Text>No episodes found</Text>
			)}
		</Stack>
	) : null;
};
