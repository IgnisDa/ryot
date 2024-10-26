import { Drawer, Stack, Text } from "@mantine/core";
import { isNumber } from "@ryot/ts-utils";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { useMetadataDetails, useUserMetadataDetails } from "~/lib/shared/hooks";
import { DisplayShowEpisode } from "../displays/show-episode";
import { getShowSeasonDisplayName } from "../displays/show-season";

export const DisplayShowSeasonEpisodesModal = (props: {
	metadataId: string;
	openedShowSeason: number | undefined;
	setOpenedShowSeason: (v: number | undefined) => void;
}) => {
	const [{ data: metadataDetails }] = useMetadataDetails(props.metadataId);
	const showSpecifics = metadataDetails?.showSpecifics;
	const season = useMemo(() => {
		return isNumber(props.openedShowSeason) && showSpecifics
			? showSpecifics.seasons[props.openedShowSeason]
			: undefined;
	}, [props.openedShowSeason, showSpecifics]);
	const title = useMemo(() => {
		return season ? getShowSeasonDisplayName(season, season.name) : "";
	}, [season]);

	return (
		<Drawer
			zIndex={150}
			title={title}
			opened={props.openedShowSeason !== undefined}
			onClose={() => props.setOpenedShowSeason(undefined)}
		>
			{isNumber(props.openedShowSeason) ? (
				<DisplayShowSeasonEpisodes
					metadataId={props.metadataId}
					openedShowSeason={props.openedShowSeason}
				/>
			) : null}
		</Drawer>
	);
};

const DisplayShowSeasonEpisodes = (props: {
	openedShowSeason: number;
	metadataId: string;
}) => {
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);
	const [{ data: metadataDetails }] = useMetadataDetails(props.metadataId);
	const season =
		metadataDetails?.showSpecifics?.seasons[props.openedShowSeason];
	const seasonProgress =
		userMetadataDetails?.showProgress?.[props.openedShowSeason];

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
							metadataId={props.metadataId}
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
