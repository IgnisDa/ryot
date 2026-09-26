import { Result } from "@ryot-app/client-sdk/effect";
import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";

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
	isMonitored: false,
	providerName: "TMDB",
	isInMediaLibrary: true,
	completedMemberCount: 2,
	schemaSlug: "movie-group",
	populationStatus: "ready",
	translationStatus: "none",
	name: "The Matrix Collection",
	description: "Humanity against the machines.",
	sourceUrl: "https://tmdb.test/collection/2344",
	collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
	memberImages: [{ type: "remote", purpose: "cover", url: "https://images.test/matrix.jpg" }],
};

export const decodeGroupSummaryOf = <Summary>(
	recipes: {
		readonly summaryRecipe: (input: {
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
		recipes.summaryRecipe({ collectionLimit: 6, entityId: "group-1" }),
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
	images: null,
	publishDate: null,
	publishYear: null,
	state: "complete",
	progressPercent: null,
	schemaSlug: "fixture",
	productionStatus: null,
	populationStatus: "ready",
	translationStatus: "none",
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
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "s3", key: "nina", purpose: "profile" }],
};

export const groupLabelCreditRow = {
	order: 1,
	name: "Verve",
	id: "company-1",
	roles: ["Label"],
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "s3", key: "verve", purpose: "logo" }],
};

export const decodeCreditGroupOverviewOf = <Overview>(recipes: {
	readonly overviewRecipe: (input: {
		readonly entityId: string;
		readonly peopleLimit: number;
		readonly companyLimit: number;
	}) => PreparedRecipe<Overview>;
}) =>
	Result.getOrThrow(
		recipes
			.overviewRecipe({ peopleLimit: 12, companyLimit: 6, entityId: "group-1" })
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
	recipes: {
		readonly presentationRecipe: (
			entityIds: readonly string[],
		) => PreparedRecipe<readonly Presentation[]>;
	},
	row: Record<string, unknown>,
) => {
	const [decoded] = Result.getOrThrow(
		recipes
			.presentationRecipe(["group-1"])
			.decode({
				data: {
					rows: rowsResult([{ ...groupSummaryRow, ...row }], {
						limit: 100,
						hasMore: false,
						nextCursor: null,
					}),
				},
			}),
	);
	if (decoded === undefined) {
		throw new Error("Expected decoded group presentation data");
	}
	return { ...decoded, batchAssets: [] };
};

export const decodeGroupActivity = (input: Parameters<typeof creatorActivityData>[0] = {}) =>
	Result.getOrThrow(
		groupFixtureRecipes
			.activityRecipe({ eventLimit: 60, entityId: "group-1", collectionEventLimit: 60 })
			.decode({ data: creatorActivityData(input) }),
	);
