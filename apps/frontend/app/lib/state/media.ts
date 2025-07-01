import {
	type EntityLot,
	MediaLot,
	MetadataDetailsDocument,
	type ReviewItem,
} from "@ryot/generated/graphql/backend/graphql";
import { atom, useAtom } from "jotai";
import { useState } from "react";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import {
	clientGqlService,
	getMetadataDetailsQuery,
	getUserMetadataDetailsQuery,
	queryClient,
} from "~/lib/common";

export type UpdateProgressData = {
	metadataId: string;
	providerWatchedOn?: string | null;
	showSeasonNumber?: number | null;
	showEpisodeNumber?: number | null;
	podcastEpisodeNumber?: number | null;
	animeEpisodeNumber?: number | null;
	mangaChapterNumber?: string | null;
	mangaVolumeNumber?: number | null;
	showAllEpisodesBefore?: boolean;
	animeAllEpisodesBefore?: boolean;
	podcastAllEpisodesBefore?: boolean;
	mangaAllChaptersOrVolumesBefore?: boolean;
};

const metadataProgressUpdateAtom = atom<UpdateProgressData | null>(null);

const getUpdateMetadata = async (metadataId: string) => {
	const meta = await queryClient.ensureQueryData(
		getMetadataDetailsQuery(metadataId),
	);
	if (!meta.isPartial || ![MediaLot.Show, MediaLot.Podcast].includes(meta.lot))
		return meta;

	const { metadataDetails } = await clientGqlService.request(
		MetadataDetailsDocument,
		{
			metadataId,
			ensureUpdated: true,
		},
	);
	await queryClient.invalidateQueries({
		queryKey: getMetadataDetailsQuery(metadataId).queryKey,
	});
	return metadataDetails;
};

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
				getUpdateMetadata(draft.metadataId),
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
					.with(MediaLot.Anime, () => {
						draft.animeEpisodeNumber = nextEntry.episode;
					})
					.with(MediaLot.Manga, () => {
						draft.mangaChapterNumber = nextEntry.chapter;
					})
					.otherwise(() => undefined);
			}
		}
		setIsLoading(false);
		_setMetadataProgress(draft);
	};
	return [metadataProgress, setMetadataProgress, isLoading] as const;
};

export type ReviewEntityData = {
	entityId: string;
	entityLot: EntityLot;
	entityTitle: string;
	metadataLot?: MediaLot;
	existingReview?: DeepPartial<ReviewItem>;
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
