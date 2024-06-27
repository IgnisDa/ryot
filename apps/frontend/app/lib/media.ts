import {
	MetadataDetailsDocument,
	type MetadataDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { atom, useAtom } from "jotai";
import invariant from "tiny-invariant";
import { clientGqlService, queryClient } from "./generals";

export type UpdateProgressFormData = {
	watchProviders: string[];
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
};

export type UpdateProgressData = {
	onlySeason?: boolean;
	completeShow?: boolean;
	completePodcast?: boolean;
	showSeasonNumber?: number | null;
	showEpisodeNumber?: number | null;
	podcastEpisodeNumber?: number | null;
};

const mediaProgressUpdateAtom = atom<{
	toUpdate: UpdateProgressData;
	form: UpdateProgressFormData;
} | null>(null);

export const useRawMediaProgress = () => {
	return useAtom(mediaProgressUpdateAtom);
};

export const useMediaProgress = (form?: UpdateProgressFormData) => {
	const [mediaProgress, setMediaProgress] = useAtom(mediaProgressUpdateAtom);
	const updateProgress = (
		toUpdate: UpdateProgressData,
		newForm?: UpdateProgressFormData,
	) => {
		const toUpdateForm = newForm ?? form;
		invariant(
			toUpdateForm,
			"form must be provided to useMediaProgress or updateProgress",
		);
		setMediaProgress({ toUpdate, form: toUpdateForm });
	};
	return [mediaProgress, updateProgress] as const;
};

export type TSetMediaProgress = ReturnType<typeof useMediaProgress>[1];

export const getMetadataDetailsWithReactQuery = async (id: string) => {
	return await queryClient.ensureQueryData({
		queryKey: ["metadataDetails", id],
		queryFn: async () => {
			const { metadataDetails } = await clientGqlService.request(
				MetadataDetailsDocument,
				{ metadataId: id },
			);
			return metadataDetails;
		},
	});
};
