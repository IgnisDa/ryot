import {
	type EntityLot,
	MediaLot,
	type ReviewItem,
} from "@ryot/generated/graphql/backend/graphql";
import { atom, useAtom } from "jotai";
import { match } from "ts-pattern";
import {
	getMetadataDetailsQuery,
	getUserMetadataDetailsQuery,
	queryClient,
} from "~/lib/shared/react-query";

export type UpdateProgressData = {
	metadataId: string;
	showSeasonNumber?: number;
	mangaVolumeNumber?: number;
	showEpisodeNumber?: number;
	animeEpisodeNumber?: number;
	mangaChapterNumber?: string;
	podcastEpisodeNumber?: number;
	providersConsumedOn?: string[];
	showAllEpisodesBefore?: boolean;
	animeAllEpisodesBefore?: boolean;
	podcastAllEpisodesBefore?: boolean;
	showSeasonEpisodesBefore?: boolean;
	mangaAllChaptersOrVolumesBefore?: boolean;
};

const metadataProgressUpdateAtom = atom<UpdateProgressData | null>(null);

export const useMetadataProgressUpdate = () => {
	const [metadataToUpdate, setProgress] = useAtom(metadataProgressUpdateAtom);

	const initializeMetadataToUpdate = async (
		draft: UpdateProgressData | null,
		determineNext?: boolean,
	) => {
		if (draft) {
			const [metadataDetails, userMetadataDetails] = await Promise.all([
				queryClient.ensureQueryData(getMetadataDetailsQuery(draft.metadataId)),
				queryClient.ensureQueryData(
					getUserMetadataDetailsQuery(draft.metadataId),
				),
			]);
			draft.providersConsumedOn = [
				...(userMetadataDetails.history.at(0)?.providersConsumedOn || []),
			];
			if (determineNext) {
				const nextEntry = userMetadataDetails?.nextEntry;
				if (nextEntry) {
					match(metadataDetails.lot)
						.with(MediaLot.Manga, () => {
							draft.mangaChapterNumber = nextEntry.chapter || undefined;
						})
						.with(MediaLot.Anime, () => {
							draft.animeEpisodeNumber = nextEntry.episode || undefined;
						})
						.with(MediaLot.Podcast, () => {
							draft.podcastEpisodeNumber = nextEntry.episode || undefined;
						})
						.with(MediaLot.Show, () => {
							draft.showSeasonNumber = nextEntry.season || undefined;
							draft.showEpisodeNumber = nextEntry.episode || undefined;
						})
						.otherwise(() => undefined);
				}
			}
		}
		setProgress(draft);
	};

	const updateMetadataToUpdate = (draft: UpdateProgressData | null) => {
		setProgress(draft);
	};

	return {
		metadataToUpdate,
		updateMetadataToUpdate,
		initializeMetadataToUpdate,
	};
};

export type ReviewEntityData = {
	entityId: string;
	entityLot: EntityLot;
	entityTitle: string;
	metadataLot?: MediaLot;
	existingReview?: Partial<ReviewItem>;
};

export const reviewEntityAtom = atom<ReviewEntityData | null>(null);

export const useReviewEntity = () => {
	return useAtom(reviewEntityAtom);
};

export type AddEntityToCollectionsData = {
	entityId: string;
	entityLot: EntityLot;
};

export const addEntityToCollectionsAtom =
	atom<AddEntityToCollectionsData | null>(null);

export const useAddEntityToCollections = () => {
	return useAtom(addEntityToCollectionsAtom);
};
