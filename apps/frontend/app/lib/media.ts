import {
	MetadataDetailsDocument,
	UserPreferencesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { skipToken, useQuery } from "@tanstack/react-query";
import { experimental_createPersister } from "@tanstack/react-query-persist-client";
import { atom, useAtom } from "jotai";
import { clientGqlService } from "./generals";

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

const createPersister = () =>
	experimental_createPersister({
		storage: typeof window !== "undefined" ? window.localStorage : undefined,
	});

export const useMetadataDetails = (id?: string | null) => {
	return useQuery({
		queryKey: ["metadataDetails", id],
		queryFn: id
			? async () => {
					const { metadataDetails } = await clientGqlService.request(
						MetadataDetailsDocument,
						{ metadataId: id },
					);
					return metadataDetails;
				}
			: skipToken,
		persister: createPersister(),
	});
};

export const useUserPreferences = () => {
	return useQuery({
		queryKey: ["userPreferences"],
		queryFn: async () => {
			const { userPreferences } = await clientGqlService.request(
				UserPreferencesDocument,
			);
			return userPreferences;
		},
		persister: createPersister(),
	});
};
