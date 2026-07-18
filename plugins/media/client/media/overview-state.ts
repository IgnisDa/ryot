import type { RyotQueryResult } from "@ryot-app/client-sdk/react";
import type { SelectedRow } from "@ryot-app/client-sdk/ryotql";

import type {
	creditSelection,
	MediaOverviewRows,
	MediaUnlinkedCreatorsOverview,
} from "../../shared/media-recipes";
import { collectManagedAssetLocators, preferredMediaImageAsset } from "./image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";
import { mediaPosterAsset } from "./summary-state";

export type MediaPerson = MediaOverviewRows["people"]["items"][number];

export type MediaCreditPerson = SelectedRow<ReturnType<typeof creditSelection>> & {
	readonly character?: string | null | undefined;
};

export type MediaCompany = MediaOverviewRows["companies"]["items"][number];

export type MediaRecommendation = MediaOverviewRows["recommendations"]["items"][number];

export type MediaUnlinkedCreator = { readonly name: string; readonly role: string };

export const mediaUnlinkedCreators = (overview: MediaUnlinkedCreatorsOverview) =>
	overview.creators?.unlinkedCreators ?? [];

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

export const mediaOverviewError = (state: MediaOverviewFailure, subject: string) => ({
	title: "Unable to load these details",
	detail:
		state.status === "transport-error"
			? `${subject} could not be loaded. Check your connection and try again.`
			: "These details came back in a form that could not be displayed. Try again later.",
});

export const mediaPersonAsset = (person: MediaCreditPerson) =>
	preferredMediaImageAsset(person.images, "profile");

export const mediaCompanyAsset = (company: MediaCompany) =>
	preferredMediaImageAsset(company.images, "logo");

export const mediaCreditAssets = (credits: {
	readonly people: { readonly items: readonly MediaCreditPerson[] };
	readonly companies: { readonly items: readonly MediaCompany[] };
}) => [
	...credits.people.items.map(mediaPersonAsset),
	...credits.companies.items.map(mediaCompanyAsset),
];

export const mediaOverviewAssets = (overview: MediaOverviewRows) => [
	...mediaCreditAssets(overview),
	...overview.recommendations.items.map((recommendation) => mediaPosterAsset(recommendation)),
];

export const mediaOverviewManagedAssets = (overview: MediaOverviewRows) =>
	collectManagedAssetLocators(mediaOverviewAssets(overview));

export const mediaRolesLabel = (roles: readonly string[] | null) =>
	roles === null || roles.length === 0 ? undefined : roles.join(", ");

export const mediaCharacterLabel = (character: string | null) =>
	character === null || character === "" ? undefined : `as ${character}`;

const UNLINKED_COMPANY_ROLE = "Publisher";

export const mediaUnlinkedCredits = (unlinked: readonly MediaUnlinkedCreator[]) => ({
	people: unlinked.filter(({ role }) => role !== UNLINKED_COMPANY_ROLE),
	companies: unlinked.filter(({ role }) => role === UNLINKED_COMPANY_ROLE),
});

export const mediaRelationsAreEmpty = (
	overview: MediaOverviewRows,
	unlinked: readonly MediaUnlinkedCreator[] = [],
) =>
	unlinked.length === 0 &&
	overview.people.items.length === 0 &&
	overview.companies.items.length === 0 &&
	overview.recommendations.items.length === 0;
