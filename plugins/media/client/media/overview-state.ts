import type { Formatters, RyotQueryResult } from "@ryot-app/plugin-client-sdk/react";

import type { MediaCreatorCredit } from "../../shared/creator-recipes";
import type { CreditRoleCode, UnlinkedCreator } from "../../shared/credit-roles";
import type { MediaOverviewRows, MediaUnlinkedCreatorsOverview } from "../../shared/media-recipes";
import type { MediaCopy, MediaText } from "../messages";
import { collectManagedAssetLocators, preferredMediaImageAsset } from "./image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";
import { mediaPosterAsset } from "./summary-state";

export type MediaCreditPerson = MediaCreatorCredit;

export type MediaUnlinkedCreator = UnlinkedCreator;

export type MediaPerson = MediaOverviewRows["people"]["items"][number];

export type MediaCompany = MediaOverviewRows["companies"]["items"][number];

export type MediaRecommendation = MediaOverviewRows["recommendations"]["items"][number];

export const mediaUnlinkedCreators = (overview: MediaUnlinkedCreatorsOverview) =>
	overview.creators?.unlinkedCreators ?? [];

export type MediaOverviewState<Overview> = MappedRyotQueryState<{
	readonly status: "ready";
	readonly overview: Overview;
}>;

type MediaOverviewFailure = Pick<
	Extract<MediaOverviewState<never>, { status: "malformed" | "transport-error" }>,
	"status"
>;

export const mapMediaOverview = <Overview>(
	result: RyotQueryResult<Overview>,
): MediaOverviewState<Overview> => {
	const state = classifyRyotQueryResult(result);
	return state.status === "ready" ? { status: "ready", overview: state.value } : state;
};

export const mediaOverviewError = (
	text: MediaText,
	state: MediaOverviewFailure,
	subject: string,
) => ({
	title: text("summary.error-load-title"),
	detail:
		state.status === "transport-error"
			? text("overview.error-transport", { subject })
			: text("overview.error-malformed"),
});

export const mediaPersonAsset = (person: MediaCreditPerson) =>
	preferredMediaImageAsset(person.images, "profile");

export const mediaCompanyAsset = (company: MediaCompany) =>
	preferredMediaImageAsset(company.images, "logo");

export const mediaCreditAssets = (credits: {
	readonly companies: { readonly items: readonly MediaCompany[] };
	readonly people: { readonly items: readonly MediaCreditPerson[] };
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

export const mediaListLabel = (formatters: Formatters, values: null | readonly string[]) =>
	values === null || values.length === 0
		? undefined
		: formatters.list({ type: "unit", style: "short" }).format(values);

/** Standard roles first, then the roles the provider names. */
export const mediaCreditRolesLabel = (
	{ text, formatters }: Pick<MediaCopy, "text" | "formatters">,
	credit: {
		readonly roles: null | readonly string[];
		readonly roleCodes: null | readonly CreditRoleCode[];
	},
) =>
	mediaListLabel(formatters, [
		...(credit.roleCodes ?? []).map((role) => text("credits.role", { role })),
		...(credit.roles ?? []),
	]);

export const mediaUnlinkedRoleLabel = (text: MediaText, creator: MediaUnlinkedCreator) =>
	creator.roleCode === undefined ? creator.role : text("credits.role", { role: creator.roleCode });

export const mediaUnlinkedCreatorKey = (creator: MediaUnlinkedCreator) =>
	`${creator.roleCode ?? creator.role ?? ""}:${creator.name}`;

export const mediaCharacterLabel = (text: MediaText, character: null | string) =>
	character === null || character === "" ? undefined : text("credits.character", { character });

export const mediaUnlinkedCredits = (unlinked: readonly MediaUnlinkedCreator[]) => ({
	people: unlinked.filter(({ roleCode }) => roleCode !== "publisher"),
	companies: unlinked.filter(({ roleCode }) => roleCode === "publisher"),
});

export const mediaRelationsAreEmpty = (
	overview: MediaOverviewRows,
	unlinked: readonly MediaUnlinkedCreator[] = [],
) =>
	unlinked.length === 0 &&
	overview.people.items.length === 0 &&
	overview.companies.items.length === 0 &&
	overview.recommendations.items.length === 0;
