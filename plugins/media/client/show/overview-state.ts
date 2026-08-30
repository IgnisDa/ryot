import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { ShowOverviewResult } from "../../shared/show-recipes";
import { collectManagedAssetLocators, preferredMediaImageAsset } from "./media-image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";

export type ShowOverview = ShowOverviewResult;

export type ShowPerson = ShowOverview["people"]["items"][number];

export type ShowCompany = ShowOverview["companies"]["items"][number];

export type ShowRecommendation = ShowOverview["recommendations"]["items"][number];

export type ShowOverviewState = MappedRyotQueryState<{
	readonly status: "ready";
	readonly overview: ShowOverview;
}>;

type ShowOverviewFailure = Pick<
	Extract<ShowOverviewState, { status: "transport-error" | "malformed" }>,
	"status"
>;

export const mapShowOverview = (result: RyotQueryResult<ShowOverviewResult>): ShowOverviewState => {
	const state = classifyRyotQueryResult(result);
	return state.status === "ready" ? { status: "ready", overview: state.value } : state;
};

export const showOverviewError = (state: ShowOverviewFailure) => ({
	title: "Unable to load these details",
	detail:
		state.status === "transport-error"
			? "The cast, companies and recommendations could not be loaded. Check your connection and try again."
			: "These details came back in a form that could not be displayed. Try again later.",
});

export const showPersonAsset = (person: ShowPerson) =>
	preferredMediaImageAsset(person.images, "profile");

export const showCompanyAsset = (company: ShowCompany) =>
	preferredMediaImageAsset(company.images, "logo");

export const showRecommendationAsset = (recommendation: ShowRecommendation) =>
	preferredMediaImageAsset(recommendation.images, "cover");

export const showOverviewManagedAssets = (overview: ShowOverview) =>
	collectManagedAssetLocators([
		...overview.people.items.map(showPersonAsset),
		...overview.companies.items.map(showCompanyAsset),
		...overview.recommendations.items.map(showRecommendationAsset),
	]);

export const showRolesLabel = (roles: readonly string[] | null) =>
	roles === null || roles.length === 0 ? undefined : roles.join(", ");

export const showCharacterLabel = (character: string | null) =>
	character === null || character === "" ? undefined : `as ${character}`;

export const showOverviewIsEmpty = (overview: ShowOverview) =>
	overview.people.items.length === 0 &&
	overview.companies.items.length === 0 &&
	overview.recommendations.items.length === 0;
