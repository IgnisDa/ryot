import { describe, expect, it } from "bun:test";

import { assert } from "@ryot-app/testing/assert";

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
import { testMediaCopy, testMediaText } from "../../tests/client/test-text";
import {
	mapMediaOverview,
	mediaCharacterLabel,
	mediaCompanyAsset,
	mediaCreditRolesLabel,
	mediaOverviewError,
	mediaOverviewManagedAssets,
	mediaPersonAsset,
	mediaRelationsAreEmpty,
	mediaUnlinkedCredits,
	mediaUnlinkedRoleLabel,
} from "./overview-state";
import { mediaPosterAsset } from "./summary-state";

describe("media overview state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapMediaOverview(pendingQueryResult())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapMediaOverview(malformedQueryResult()).status).toBe("malformed");
		expect(mapMediaOverview(transportErrorQueryResult()).status).toBe("transport-error");
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(
			mediaOverviewError(testMediaText, { status: "malformed" }, "Credits").detail,
		).not.toContain("RyotQL");
		const failure = mediaOverviewError(testMediaText, { status: "transport-error" }, "Credits");
		expect<string>(failure.title).toBe("Unable to load these details");
		expect<string>(failure.detail).toBe(
			"Credits could not be loaded. Check your connection and try again.",
		);
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
		expect(mediaPosterAsset(recommendation)).toEqual({
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
		expect(mediaPosterAsset(recommendation)).toBeUndefined();
		expect(mediaOverviewManagedAssets(overview)).toEqual([]);
	});

	it("collects only the managed locators the overview renders", () => {
		const overview = decodeShowOverview({
			companies: [
				{ ...showCompanyRow, images: [{ type: "local", purpose: "logo", key: "company-logo" }] },
			],
			recommendations: [
				{
					...showRecommendationRow,
					images: [{ type: "s3", purpose: "cover", key: "suggested-cover" }],
				},
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

	it("labels unlinked creators by their standard or source role and lists publishers as companies", () => {
		const unlinked = [
			{ name: "Ada", roleCode: "author" },
			{ name: "Penguin", roleCode: "publisher" },
			{ name: "Bea", role: "Translator" },
		] as const;
		expect(unlinked.map((creator) => mediaUnlinkedRoleLabel(testMediaText, creator))).toEqual([
			"Author",
			"Publisher",
			"Translator",
		]);
		expect(mediaUnlinkedCredits(unlinked)).toEqual({
			companies: [unlinked[1]],
			people: [unlinked[0], unlinked[2]],
		});
	});

	it("labels recorded roles and characters and omits the ones providers left out", () => {
		expect(
			mediaCreditRolesLabel(testMediaCopy, {
				roleCodes: ["creator"],
				roles: ["Director", "Guest Star"],
			}),
		).toBe("Creator, Director, Guest Star");
		expect(mediaCreditRolesLabel(testMediaCopy, { roles: [], roleCodes: null })).toBeUndefined();
		expect(mediaCreditRolesLabel(testMediaCopy, { roles: null, roleCodes: null })).toBeUndefined();
		expect<string | undefined>(mediaCharacterLabel(testMediaText, "Jamie")).toBe("as Jamie");
		expect(mediaCharacterLabel(testMediaText, "")).toBeUndefined();
		expect(mediaCharacterLabel(testMediaText, null)).toBeUndefined();
	});
});
