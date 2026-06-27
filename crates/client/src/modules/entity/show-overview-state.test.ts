import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import {
	decodeShowOverview,
	emptyShowOverview,
	showCompanyRow,
	showPersonRow,
	showRecommendationRow,
} from "./show-overview-fixture";
import {
	mapShowOverview,
	showCharacterLabel,
	showCompanyAsset,
	showOverviewEntityIds,
	showOverviewError,
	showOverviewIsEmpty,
	showOverviewManagedAssets,
	showPersonAsset,
	showRecommendationAsset,
	showRolesLabel,
} from "./show-overview-state";

describe("show overview state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapShowOverview(AsyncResult.initial(true))).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		const malformed = Cause.fail(new RyotQLMalformedResultError("bad credit row"));
		const transport = Cause.fail(new Error("offline"));

		expect(mapShowOverview(AsyncResult.failure(malformed)).status).toBe("malformed");
		expect(mapShowOverview(AsyncResult.failure(transport)).status).toBe("transport-error");
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(showOverviewError({ status: "malformed" }).detail).not.toContain("RyotQL");
		expect(showOverviewError({ status: "transport-error" })).toEqual({
			title: "Unable to load these details",
			detail:
				"The cast, companies and recommendations could not be loaded. Check your connection and try again.",
		});
	});

	it("maps decoded relational rows to the ready state", () => {
		const state = mapShowOverview(AsyncResult.success(decodeShowOverview()));

		expect(state).toMatchObject({
			status: "ready",
			overview: {
				people: { items: [{ id: "person-1", name: "Owen Cooper" }] },
				companies: { items: [{ id: "company-1", name: "Warp Films" }] },
				recommendations: { items: [{ id: "show-2", name: "Bad Girls" }] },
			},
		});
	});

	it("extracts displayed related entity IDs by overview group", () => {
		expect(showOverviewEntityIds(decodeShowOverview())).toEqual([
			"person-1",
			"company-1",
			"show-2",
		]);
	});

	it("returns no related entity IDs for an empty overview", () => {
		expect(showOverviewEntityIds(emptyShowOverview())).toEqual([]);
	});

	it("reports a show with no credits, companies or suggestions as empty", () => {
		expect(showOverviewIsEmpty(emptyShowOverview())).toBe(true);
		expect(showOverviewIsEmpty(decodeShowOverview())).toBe(false);
		expect(showOverviewIsEmpty(decodeShowOverview({ people: [], companies: [] }))).toBe(false);
	});

	it("prefers the purpose that suits each relationship and falls back to provider order", () => {
		const overview = decodeShowOverview({
			people: [{ ...showPersonRow, images: [{ type: "s3", key: "still", purpose: "still" }] }],
			companies: [{ ...showCompanyRow, images: [{ type: "local", key: "logo", purpose: "logo" }] }],
		});
		const [person] = overview.people.items;
		const [company] = overview.companies.items;
		const [recommendation] = overview.recommendations.items;

		expect(showPersonAsset(person)).toEqual({ type: "s3", key: "still" });
		expect(showCompanyAsset(company)).toEqual({ type: "local", key: "logo" });
		expect(showRecommendationAsset(recommendation)).toEqual({
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

		expect(showPersonAsset(person)).toBeUndefined();
		expect(showCompanyAsset(company)).toBeUndefined();
		expect(showRecommendationAsset(recommendation)).toBeUndefined();
		expect(showOverviewManagedAssets(overview)).toEqual([]);
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
						{ type: "s3", key: "person-profile", purpose: "profile" },
						{ type: "s3", key: "person-still", purpose: "still" },
					],
				},
			],
		});

		expect(showOverviewManagedAssets(overview)).toEqual([
			{ type: "local", key: "company-logo" },
			{ type: "s3", key: "person-profile" },
			{ type: "s3", key: "suggested-cover" },
		]);
	});

	it("labels recorded roles and characters and omits the ones providers left out", () => {
		expect(showRolesLabel(["Actor", "Guest Star"])).toBe("Actor, Guest Star");
		expect(showRolesLabel([])).toBeUndefined();
		expect(showRolesLabel(null)).toBeUndefined();
		expect(showCharacterLabel("Jamie")).toBe("as Jamie");
		expect(showCharacterLabel("")).toBeUndefined();
		expect(showCharacterLabel(null)).toBeUndefined();
	});
});
