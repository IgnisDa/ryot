import { Drawer, Stack, Text } from "@mantine/core";
import {
	EntityLot,
	EntityTranslationVariant,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber } from "@ryot/ts-utils";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { useTranslationValue } from "~/lib/shared/hooks";
import { DisplayShowEpisode } from "../displays/show-episode";
import type { MetadataDetails, Season, UserMetadataDetails } from "../types";

const getShowSeasonDisplayName = (season: Season, title: string) =>
	`${season.seasonNumber}. ${title}`;

export const DisplayShowSeasonEpisodesModal = (props: {
	metadataDetails: MetadataDetails;
	openedShowSeason: number | undefined;
	userMetadataDetails: UserMetadataDetails;
	setOpenedShowSeason: (v: number | undefined) => void;
}) => {
	const showSpecifics = props.metadataDetails.showSpecifics;
	const season = useMemo(() => {
		return isNumber(props.openedShowSeason) && showSpecifics
			? showSpecifics.seasons[props.openedShowSeason]
			: undefined;
	}, [props.openedShowSeason, showSpecifics]);
	const showExtraInformation = useMemo(() => {
		return season ? { season: season.seasonNumber } : undefined;
	}, [season]);
	const seasonTitleTranslation = useTranslationValue({
		showExtraInformation,
		enabled: Boolean(season),
		entityLot: EntityLot.Metadata,
		entityId: props.metadataDetails.id,
		variant: EntityTranslationVariant.Title,
	});
	const title = useMemo(() => {
		return season
			? getShowSeasonDisplayName(season, seasonTitleTranslation ?? season.name)
			: "";
	}, [season, seasonTitleTranslation]);

	return (
		<Drawer
			zIndex={150}
			title={title}
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
