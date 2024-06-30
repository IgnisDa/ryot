import { atom, useAtom } from "jotai";

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

export const useMetadataProgressUpdate = () =>
	useAtom(metadataProgressUpdateAtom);
