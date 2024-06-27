import type { MetadataDetailsQuery } from "@ryot/generated/graphql/backend/graphql";

export type UpdateProgressFormData = {
	watchProviders: string[];
	redirectToQueryParam?: string;
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
