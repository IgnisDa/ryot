import type {
	MetadataDetailsQuery,
	UserMetadataDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";

export type MetadataDetails =
	MetadataDetailsQuery["metadataDetails"]["response"];
export type UserMetadataDetails =
	UserMetadataDetailsQuery["userMetadataDetails"]["response"];
export type Season = NonNullable<
	MetadataDetails["showSpecifics"]
>["seasons"][number];
export type SeasonProgress = NonNullable<
	UserMetadataDetails["showProgress"]
>[number];
export type History = UserMetadataDetails["history"][number];

export type DurationInput = {
	[K in (typeof POSSIBLE_DURATION_UNITS)[number]]?: number;
};

export const POSSIBLE_DURATION_UNITS = ["mo", "d", "h", "min"] as const;
