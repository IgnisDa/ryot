import { Result } from "@ryot-app/plugin-client-sdk/effect";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import type { MediaPresentationSource } from "../../../shared/entity-presentations";
import { creatorActivityData } from "../creator/activity-fixture";
import { rowsResult } from "../query-result-fixture";
import { decodeMediaSummaryResult } from "../summary-fixture";
import { creditGroupFixtureRecipes, groupFixtureRecipes } from "./recipes";

export const GROUP_MEMBER_PAGE_LIMIT = 20;

export const groupSummaryRow = {
	parts: 5,
	images: [],
	id: "group-1",
	memberCount: 5,
	isCustom: false,
	isMonitored: false,
	providerName: "TMDB",
	isInMediaLibrary: true,
	completedMemberCount: 2,
	schemaSlug: "movie-group",
	name: "The Matrix Collection",
	description: "Humanity against the machines.",
	sourceUrl: "https://tmdb.test/collection/2344",
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
	memberImages: [{ type: "remote", purpose: "cover", url: "https://images.test/matrix.jpg" }],
};

export const decodeGroupSummaryOf = <Summary>(
	recipes: {
		readonly summaryRecipe: (input: {
			readonly reference: PluginIdentityReference;
			readonly entityId: string;
			readonly collectionLimit: number;
		}) => PreparedRecipe<{
			readonly summary: Summary | null;
			readonly entitySchemaSlug: string | null;
		}>;
	},
	overrides: Record<string, unknown> = {},
) => {
	const { summary } = decodeMediaSummaryResult(
		recipes.summaryRecipe({ collectionLimit: 6, entityId: "group-1", reference: { kind: "self" } }),
		{ requested: [{ schemaSlug: "movie-group" }], summary: [{ ...groupSummaryRow, ...overrides }] },
	);
	if (summary === null) {
		throw new Error("Expected a decoded group summary");
	}
	return summary;
};

export const decodeGroupSummary = (overrides: Record<string, unknown> = {}) =>
	decodeGroupSummaryOf(groupFixtureRecipes, overrides);

export const groupMemberRow = (overrides: Record<string, unknown>) => ({
	image: null,
	publishDate: null,
	publishYear: null,
	state: "complete",
	progressPercent: null,
	schemaSlug: "fixture",
	productionStatus: null,
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
	...overrides,
});

export const groupMemberPageData = (input: {
	readonly nextCursor?: string | null;
	readonly members: readonly Record<string, unknown>[];
}) => ({
	data: {
		members: rowsResult(input.members, {
			limit: GROUP_MEMBER_PAGE_LIMIT,
			nextCursor: input.nextCursor ?? null,
			hasMore: (input.nextCursor ?? null) !== null,
		}),
	},
});

const creditRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 12, hasMore: false, nextCursor: null });

export const groupArtistCreditRow = {
	order: 1,
	id: "person-1",
	roles: ["Artist"],
	name: "Nina Simone",
	images: [{ type: "s3", key: "nina", purpose: "profile" }],
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
};

export const groupLabelCreditRow = {
	order: 1,
	name: "Verve",
	id: "company-1",
	roles: ["Label"],
	images: [{ type: "s3", key: "verve", purpose: "logo" }],
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
};

export const decodeCreditGroupOverviewOf = <Overview>(recipes: {
	readonly overviewRecipe: (input: {
		readonly reference: PluginIdentityReference;
		readonly entityId: string;
		readonly peopleLimit: number;
		readonly companyLimit: number;
	}) => PreparedRecipe<Overview>;
}) =>
	Result.getOrThrow(
		recipes
			.overviewRecipe({
				peopleLimit: 12,
				companyLimit: 6,
				entityId: "group-1",
				reference: { kind: "self" },
			})
			.decode({
				data: {
					people: creditRows([groupArtistCreditRow]),
					companies: creditRows([groupLabelCreditRow]),
				},
			}),
	);

export const decodeCreditGroupOverview = () =>
	decodeCreditGroupOverviewOf(creditGroupFixtureRecipes);

export const decodeGroupPresentation = <Presentation>(
	recipes: { readonly presentationSource: MediaPresentationSource<Presentation> },
	row: Record<string, unknown>,
) => {
	const decoded = Result.getOrThrow(
		recipes.presentationSource.decode({ ...groupSummaryRow, image: null, ...row }),
	);
	return { ...decoded, batchAssets: [] };
};

export const decodeGroupActivity = (input: Parameters<typeof creatorActivityData>[0] = {}) =>
	Result.getOrThrow(
		groupFixtureRecipes
			.activityRecipe({
				eventLimit: 60,
				entityId: "group-1",
				collectionEventLimit: 60,
				reference: { kind: "self" },
			})
			.decode({ data: creatorActivityData(input) }),
	);
