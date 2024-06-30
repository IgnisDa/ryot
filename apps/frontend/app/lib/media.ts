import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { atom, useAtom } from "jotai";
import { match } from "ts-pattern";
import { queryClient } from "./generals";
import { getMetadataDetailsQuery, getUserMetadataDetailsQuery } from "./hooks";

export type UpdateProgressData = {
	metadataId: string;
	onlySeason?: boolean;
	pageFragment?: string;
	completeShow?: boolean;
	determineNext?: boolean;
	completePodcast?: boolean;
	showSeasonNumber?: number | null;
	showEpisodeNumber?: number | null;
	podcastEpisodeNumber?: number | null;
};

const metadataProgressUpdateAtom = atom<UpdateProgressData | null>(null);

export const useMetadataProgressUpdate = () => {
	const [metadataProgress, _setMetadataProgress] = useAtom(
		metadataProgressUpdateAtom,
	);
	const setMetadataProgress = async (draft: UpdateProgressData | null) => {
		if (draft?.determineNext) {
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
		_setMetadataProgress(draft);
	};
	return [metadataProgress, setMetadataProgress] as const;
};
