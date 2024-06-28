import { atom, useAtom } from "jotai";

export type UpdateProgressData = {
	metadataId: string;
	onlySeason?: boolean;
	completeShow?: boolean;
	completePodcast?: boolean;
	showSeasonNumber?: number | null;
	showEpisodeNumber?: number | null;
	podcastEpisodeNumber?: number | null;
};

const metadataProgressUpdateAtom = atom<UpdateProgressData | null>(null);

export const useMetadataProgressUpdate = () =>
	useAtom(metadataProgressUpdateAtom);
