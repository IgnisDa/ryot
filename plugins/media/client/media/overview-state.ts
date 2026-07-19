import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { MediaOverviewRows } from "../../shared/media-recipes";
import { collectManagedAssetLocators, preferredMediaImageAsset } from "./image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";

export type MediaPerson = MediaOverviewRows["people"]["items"][number];

export type MediaCompany = MediaOverviewRows["companies"]["items"][number];

export type MediaRecommendation = MediaOverviewRows["recommendations"]["items"][number];

export type MediaOverviewState<Overview> = MappedRyotQueryState<{
	readonly status: "ready";
	readonly overview: Overview;
}>;

type MediaOverviewFailure = Pick<
	Extract<MediaOverviewState<never>, { status: "transport-error" | "malformed" }>,
	"status"
>;

export const mapMediaOverview = <Overview>(
	result: RyotQueryResult<Overview>,
): MediaOverviewState<Overview> => {
	const state = classifyRyotQueryResult(result);
	return state.status === "ready" ? { status: "ready", overview: state.value } : state;
};

export const mediaOverviewError = (state: MediaOverviewFailure) => ({
	title: "Unable to load these details",
	detail:
		state.status === "transport-error"
			? "The cast, companies and recommendations could not be loaded. Check your connection and try again."
			: "These details came back in a form that could not be displayed. Try again later.",
});

export const mediaPersonAsset = (person: MediaPerson) =>
	preferredMediaImageAsset(person.images, "profile");

export const mediaCompanyAsset = (company: MediaCompany) =>
	preferredMediaImageAsset(company.images, "logo");

export const mediaRecommendationAsset = (recommendation: MediaRecommendation) =>
	preferredMediaImageAsset(recommendation.images, "cover");

export const mediaOverviewAssets = (overview: MediaOverviewRows) => [
	...overview.people.items.map(mediaPersonAsset),
	...overview.companies.items.map(mediaCompanyAsset),
	...overview.recommendations.items.map(mediaRecommendationAsset),
];

export const mediaOverviewManagedAssets = (overview: MediaOverviewRows) =>
	collectManagedAssetLocators(mediaOverviewAssets(overview));

export const mediaRolesLabel = (roles: readonly string[] | null) =>
	roles === null || roles.length === 0 ? undefined : roles.join(", ");

export const mediaCharacterLabel = (character: string | null) =>
	character === null || character === "" ? undefined : `as ${character}`;

export const mediaRelationsAreEmpty = (overview: MediaOverviewRows) =>
	overview.people.items.length === 0 &&
	overview.companies.items.length === 0 &&
	overview.recommendations.items.length === 0;
