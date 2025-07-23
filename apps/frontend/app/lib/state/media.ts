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
import { METADATA_LOTS_WITH_GRANULAR_UPDATES } from "~/components/routes/media-item/constants";
import {
	clientGqlService,
	getMetadataDetailsQuery,
	getUserMetadataDetailsQuery,
	queryClient,
} from "~/lib/shared/query-factory";

export type UpdateProgressData = {
	metadataId: string;
	showAllEpisodesBefore?: boolean;
	animeAllEpisodesBefore?: boolean;
	showSeasonNumber?: number | null;
	providerWatchedOn?: string | null;
	mangaVolumeNumber?: number | null;
	showEpisodeNumber?: number | null;
	animeEpisodeNumber?: number | null;
	mangaChapterNumber?: string | null;
	podcastAllEpisodesBefore?: boolean;
	podcastEpisodeNumber?: number | null;
	mangaAllChaptersOrVolumesBefore?: boolean;
};

const metadataProgressUpdateAtom = atom<UpdateProgressData | null>(null);

const getUpdateMetadata = async (metadataId: string) => {
	const meta = await queryClient.ensureQueryData(
		getMetadataDetailsQuery(metadataId),
	);
	if (
		!meta.isPartial ||
		!METADATA_LOTS_WITH_GRANULAR_UPDATES.includes(meta.lot)
	)
		return meta;

	const { metadataDetails } = await clientGqlService.request(
		MetadataDetailsDocument,
		{ metadataId, ensureUpdated: true },
	);
	await queryClient.invalidateQueries({
		queryKey: getMetadataDetailsQuery(metadataId).queryKey,
	});
	return metadataDetails;
};

export const useMetadataProgressUpdate = () => {
	const [isLoading, setIsLoading] = useState(false);
	const [progress, setProgress] = useAtom(metadataProgressUpdateAtom);

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
					.with(MediaLot.Manga, () => {
						draft.mangaChapterNumber = nextEntry.chapter;
					})
					.with(MediaLot.Anime, () => {
						draft.animeEpisodeNumber = nextEntry.episode;
					})
					.with(MediaLot.Podcast, () => {
						draft.podcastEpisodeNumber = nextEntry.episode;
					})
					.with(MediaLot.Show, () => {
						draft.showSeasonNumber = nextEntry.season;
						draft.showEpisodeNumber = nextEntry.episode;
					})
					.otherwise(() => undefined);
			}
		}
		setIsLoading(false);
		setProgress(draft);
	};

	return [progress, setMetadataProgress, isLoading] as const;
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
