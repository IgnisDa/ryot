import {
	type EntityLot,
	MediaLot,
	MediaSource,
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
} from "~/lib/shared/react-query";
import { executePartialStatusUpdate } from "../shared/hooks";
import { getMetadataDetails } from "../shared/metadata-utils";

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

const getUpdateMetadata = async (metadataId: string) => {
	const meta = await queryClient.ensureQueryData(
		getMetadataDetailsQuery(metadataId),
	);
	if (
		!meta.isPartial ||
		meta.source === MediaSource.Custom ||
		!METADATA_LOTS_WITH_GRANULAR_UPDATES.includes(meta.lot)
	)
		return meta;

	await executePartialStatusUpdate({
		metadataId,
		externalLinkSource: meta.source,
	});

	const metadataDetails = await getMetadataDetails(metadataId);
	await queryClient.invalidateQueries({
		queryKey: getMetadataDetailsQuery(metadataId).queryKey,
	});
	return metadataDetails;
};

export const useMetadataProgressUpdate = () => {
	const [isMetadataToUpdateLoading, setIsLoading] = useState(false);
	const [metadataToUpdate, setProgress] = useAtom(metadataProgressUpdateAtom);

	const initializeMetadataToUpdate = async (
		draft: UpdateProgressData | null,
		determineNext?: boolean,
	) => {
		setIsLoading(true);
		if (draft) {
			const [metadataDetails, userMetadataDetails] = await Promise.all([
				getUpdateMetadata(draft.metadataId),
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
		setIsLoading(false);
		setProgress(draft);
	};

	const updateMetadataToUpdate = (draft: UpdateProgressData | null) => {
		setProgress(draft);
	};

	return {
		metadataToUpdate,
		initializeMetadataToUpdate,
		updateMetadataToUpdate,
		isMetadataToUpdateLoading,
	};
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
