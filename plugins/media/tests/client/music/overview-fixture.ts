import { Result } from "@ryot-app/client-sdk/effect";

import { musicOverviewRecipe } from "../../../shared/music-recipes";
import { rowsResult } from "../query-result-fixture";

export const musicOverviewFixtureRecipe = musicOverviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "music-1",
	recommendationLimit: 12,
});

export const musicPersonRow = {
	order: 1,
	id: "person-1",
	character: null,
	roles: ["Artist"],
	name: "Radiohead",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "profile", url: "https://images.test/radiohead.jpg" }],
};

export const musicCompanyRow = {
	order: 1,
	id: "company-1",
	roles: ["Label"],
	name: "Parlophone",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "logo", url: "https://images.test/parlophone.png" }],
};

export const musicRecommendationRow = {
	id: "music-2",
	name: "Karma Police",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/karma-police.jpg" }],
};

export const musicGroupMemberRow = {
	id: "music-3",
	name: "Let Down",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "s3", purpose: "cover", key: "let-down-cover" }],
};

export const musicGroupRow = {
	id: "album-1",
	name: "OK Computer",
	populationStatus: "ready",
	translationStatus: "none",
};

type OverviewRows = {
	readonly group?: readonly Record<string, unknown>[];
	readonly people?: readonly Record<string, unknown>[];
	readonly companies?: readonly Record<string, unknown>[];
	readonly groupTracks?: readonly Record<string, unknown>[];
	readonly recommendations?: readonly Record<string, unknown>[];
};

const overviewRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 12, hasMore: false, nextCursor: null });

const groupRows = (
	group: readonly Record<string, unknown>[],
	tracks: readonly Record<string, unknown>[],
) =>
	rowsResult(
		group.map((row) => ({
			...row,
			members: { items: tracks, pageInfo: { limit: 20, hasMore: false } },
		})),
		{ limit: 1, hasMore: false, nextCursor: null },
	);

export const decodeMusicOverview = (input: OverviewRows = {}) =>
	Result.getOrThrow(
		musicOverviewFixtureRecipe.decode({
			data: {
				people: overviewRows(input.people ?? [musicPersonRow]),
				companies: overviewRows(input.companies ?? [musicCompanyRow]),
				recommendations: overviewRows(input.recommendations ?? [musicRecommendationRow]),
				group: groupRows(
					input.group ?? [musicGroupRow],
					input.groupTracks ?? [musicGroupMemberRow],
				),
			},
		}),
	);

export const emptyMusicOverview = () =>
	decodeMusicOverview({ group: [], people: [], companies: [], recommendations: [] });

export const albumOnlyMusicOverview = () =>
	decodeMusicOverview({ people: [], companies: [], recommendations: [] });
