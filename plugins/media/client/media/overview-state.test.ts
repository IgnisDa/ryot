import { assert, describe, expect, it } from "vitest";

import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import {
	decodeShowOverview,
	emptyShowOverview,
	showCompanyRow,
	showPersonRow,
	showRecommendationRow,
} from "../../tests/client/show/overview-fixture";
import {
	mapMediaOverview,
	mediaCharacterLabel,
	mediaCompanyAsset,
	mediaOverviewError,
	mediaOverviewManagedAssets,
	mediaPersonAsset,
	mediaRecommendationAsset,
	mediaRelationsAreEmpty,
	mediaRolesLabel,
} from "./overview-state";

describe("media overview state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapMediaOverview(pendingQueryResult())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapMediaOverview(malformedQueryResult()).status).toBe("malformed");
		expect(mapMediaOverview(transportErrorQueryResult()).status).toBe("transport-error");
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(mediaOverviewError({ status: "malformed" }, "Credits").detail).not.toContain("RyotQL");
		expect(mediaOverviewError({ status: "transport-error" }, "Credits")).toEqual({
			title: "Unable to load these details",
			detail: "Credits could not be loaded. Check your connection and try again.",
		});
	});

	it("maps decoded relational rows to the ready state", () => {
		const state = mapMediaOverview(readyQueryResult(decodeShowOverview()));

		expect(state).toMatchObject({
			status: "ready",
			overview: {
				people: { items: [{ id: "person-1", name: "Owen Cooper" }] },
				companies: { items: [{ id: "company-1", name: "Warp Films" }] },
				recommendations: { items: [{ id: "show-2", name: "Bad Girls" }] },
			},
		});
	});

	it("reports an entity with no credits, companies or suggestions as empty", () => {
		expect(mediaRelationsAreEmpty(emptyShowOverview())).toBe(true);
		expect(mediaRelationsAreEmpty(decodeShowOverview())).toBe(false);
		expect(mediaRelationsAreEmpty(decodeShowOverview({ people: [], companies: [] }))).toBe(false);
	});

	it("prefers the purpose that suits each relationship and falls back to provider order", () => {
		const overview = decodeShowOverview({
			people: [{ ...showPersonRow, images: [{ type: "s3", key: "still", purpose: "still" }] }],
			companies: [{ ...showCompanyRow, images: [{ key: "logo", type: "local", purpose: "logo" }] }],
		});
		const [person] = overview.people.items;
		const [company] = overview.companies.items;
		const [recommendation] = overview.recommendations.items;
		assert(person !== undefined && company !== undefined && recommendation !== undefined);

		expect(mediaPersonAsset(person)).toEqual({ type: "s3", key: "still" });
		expect(mediaCompanyAsset(company)).toEqual({ key: "logo", type: "local" });
		expect(mediaRecommendationAsset(recommendation)).toEqual({
			type: "remote",
			url: "https://images.test/bad-girls.jpg",
		});
	});

	it("falls back to no asset when a relationship records no images", () => {
		const overview = decodeShowOverview({
			people: [{ ...showPersonRow, images: null }],
			companies: [{ ...showCompanyRow, images: [] }],
			recommendations: [{ ...showRecommendationRow, images: null }],
		});
		const [person] = overview.people.items;
		const [company] = overview.companies.items;
		const [recommendation] = overview.recommendations.items;
		assert(person !== undefined && company !== undefined && recommendation !== undefined);

		expect(mediaPersonAsset(person)).toBeUndefined();
		expect(mediaCompanyAsset(company)).toBeUndefined();
		expect(mediaRecommendationAsset(recommendation)).toBeUndefined();
		expect(mediaOverviewManagedAssets(overview)).toEqual([]);
	});

	it("collects only the managed locators the overview renders", () => {
		const overview = decodeShowOverview({
			companies: [{ ...showCompanyRow, images: [{ type: "local", key: "company-logo" }] }],
			recommendations: [
				{ ...showRecommendationRow, images: [{ type: "s3", key: "suggested-cover" }] },
			],
			people: [
				{
					...showPersonRow,
					images: [
						{ type: "s3", purpose: "profile", key: "person-profile" },
						{ type: "s3", purpose: "still", key: "person-still" },
					],
				},
			],
		});

		expect(mediaOverviewManagedAssets(overview)).toEqual([
			{ type: "local", key: "company-logo" },
			{ type: "s3", key: "person-profile" },
			{ type: "s3", key: "suggested-cover" },
		]);
	});

	it("labels recorded roles and characters and omits the ones providers left out", () => {
		expect(mediaRolesLabel(["Actor", "Guest Star"])).toBe("Actor, Guest Star");
		expect(mediaRolesLabel([])).toBeUndefined();
		expect(mediaRolesLabel(null)).toBeUndefined();
		expect(mediaCharacterLabel("Jamie")).toBe("as Jamie");
		expect(mediaCharacterLabel("")).toBeUndefined();
		expect(mediaCharacterLabel(null)).toBeUndefined();
	});
});
