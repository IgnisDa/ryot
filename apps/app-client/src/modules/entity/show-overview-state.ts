import type { ShowOverviewResult } from "@ryot/media-plugin/query-recipes";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult } from "@/api/ryotql";
import { canonicalManagedAssets } from "@/modules/ui/managed-assets";

import { preferredMediaImageAsset } from "./media-image";

export type ShowOverview = ShowOverviewResult;

export type ShowPerson = ShowOverview["people"]["items"][number];

export type ShowCompany = ShowOverview["companies"]["items"][number];

export type ShowRecommendation = ShowOverview["recommendations"]["items"][number];

export type ShowOverviewState =
	| { readonly status: "loading" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "ready"; readonly overview: ShowOverview }
	| { readonly status: "transport-error"; readonly cause: unknown };

export const mapShowOverview = (
	result: AsyncResult.AsyncResult<ShowOverviewResult, unknown>,
): ShowOverviewState => {
	const state = classifyRyotQLResult(result);
	return state.status === "ready" ? { status: "ready", overview: state.value } : state;
};

export const showOverviewError = (state: { readonly status: "transport-error" | "malformed" }) => ({
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
	canonicalManagedAssets(
		[
			...overview.people.items.map(showPersonAsset),
			...overview.companies.items.map(showCompanyAsset),
			...overview.recommendations.items.map(showRecommendationAsset),
		].flatMap((asset) => (asset === undefined || asset.type === "remote" ? [] : [asset])),
	);

export const showRolesLabel = (roles: readonly string[] | null) =>
	roles === null || roles.length === 0 ? undefined : roles.join(", ");

export const showCharacterLabel = (character: string | null) =>
	character === null || character === "" ? undefined : `as ${character}`;

export const showOverviewIsEmpty = (overview: ShowOverview) =>
	overview.people.items.length === 0 &&
	overview.companies.items.length === 0 &&
	overview.recommendations.items.length === 0;
