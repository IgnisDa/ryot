import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { atom, useAtom } from "jotai";
import { useState } from "react";
import { match } from "ts-pattern";
import { queryClient } from "./generals";
import { getMetadataDetailsQuery, getUserMetadataDetailsQuery } from "./hooks";

export type UpdateProgressData = {
	metadataId: string;
	onlySeason?: boolean;
	pageFragment?: string;
	completeShow?: boolean;
	completePodcast?: boolean;
	showSeasonNumber?: number | null;
	showEpisodeNumber?: number | null;
	podcastEpisodeNumber?: number | null;
};

const metadataProgressUpdateAtom = atom<UpdateProgressData | null>(null);

export const useMetadataProgressUpdate = () => {
	const [isLoading, setIsLoading] = useState(false);
	const [metadataProgress, _setMetadataProgress] = useAtom(
		metadataProgressUpdateAtom,
	);
	const setMetadataProgress = async (
		draft: UpdateProgressData | null,
		determineNext?: boolean,
	) => {
		setIsLoading(true);
		if (draft && determineNext) {
			const [metadataDetails, userMetadataDetails] = await Promise.all([
				queryClient.ensureQueryData(getMetadataDetailsQuery(draft.metadataId)),
				queryClient.ensureQueryData(
					getUserMetadataDetailsQuery(draft.metadataId),
				),
			]);
			const nextEntry = userMetadataDetails?.nextEntry;
			if (nextEntry) {
				match(metadataDetails.lot)
					.with(MediaLot.Show, () => {
						draft.showEpisodeNumber = nextEntry.episode;
						draft.showSeasonNumber = nextEntry.season;
					})
					.with(MediaLot.Podcast, () => {
						draft.podcastEpisodeNumber = nextEntry.episode;
					})
					.otherwise(() => undefined);
			}
		}
		setIsLoading(false);
		_setMetadataProgress(draft);
	};
	return [metadataProgress, setMetadataProgress, isLoading] as const;
};
