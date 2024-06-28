import {
	MetadataDetailsDocument,
	type MetadataDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { experimental_createPersister } from "@tanstack/react-query-persist-client";
import { atom, useAtom } from "jotai";
import invariant from "tiny-invariant";
import { clientGqlService, queryClient } from "./generals";

export type UpdateProgressGeneralData = {
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

const metadataProgressUpdateAtom = atom<{
	toUpdate: UpdateProgressData;
	form: UpdateProgressGeneralData;
} | null>(null);

export const useRawMetadataProgress = () => useAtom(metadataProgressUpdateAtom);

export const useMetadataProgress = (form?: UpdateProgressGeneralData) => {
	const [metadataProgress, setMediaProgress] = useAtom(
		metadataProgressUpdateAtom,
	);
	const updateProgress = (
		toUpdate: UpdateProgressData,
		newForm?: UpdateProgressGeneralData,
	) => {
		const toUpdateForm = newForm ?? form;
		invariant(
			toUpdateForm,
			"form must be provided to useMetadataProgress before calling updateProgress",
		);
		setMediaProgress({ toUpdate, form: toUpdateForm });
	};
	return [metadataProgress, updateProgress] as const;
};

export type TSetMetadataProgress = ReturnType<typeof useMetadataProgress>[1];

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
		persister: experimental_createPersister({ storage: window.localStorage }),
	});
};
