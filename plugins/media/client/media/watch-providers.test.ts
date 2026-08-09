import { assert, describe, expect, it } from "vitest";

import { decodeShowSummary } from "../../tests/client/show/summary-fixture";
import { watchProviderAsset, watchProviderGroups, watchProviderLink } from "./watch-providers";

const usProviders = (providers: readonly Record<string, unknown>[]) => ({
	watchProviders: [{ providers, link: null, country: "US" }],
});

describe("show watch providers", () => {
	it("groups the region's providers by offer kind in contract order", () => {
		expect(
			watchProviderGroups(decodeShowSummary(), "US").map((group) => ({
				offer: group.offer,
				label: group.label,
				providers: group.providers.map((provider) => provider.name),
			})),
		).toEqual([
			{ offer: "stream", label: "Stream", providers: ["Netflix"] },
			{ offer: "rent", label: "Rent", providers: ["Apple TV"] },
			{ offer: "buy", label: "Buy", providers: ["Apple TV"] },
		]);
	});

	it("orders the providers within an offer by name", () => {
		const show = decodeShowSummary(
			usProviders([
				{ image: null, name: "Netflix", offers: ["stream"] },
				{ image: null, offers: ["stream"], name: "BBC iPlayer" },
			]),
		);
		const [stream] = watchProviderGroups(show, "US");
		assert(stream !== undefined);

		expect(stream.providers.map((provider) => provider.name)).toEqual(["BBC iPlayer", "Netflix"]);
	});

	it("reports no groups for a region the title is not carried in", () => {
		expect(watchProviderGroups(decodeShowSummary(), "FR")).toEqual([]);
		expect(watchProviderGroups(decodeShowSummary({ watchProviders: null }), "US")).toEqual([]);
	});

	it("reports no groups and no link when the viewer's region is unknown", () => {
		expect(watchProviderGroups(decodeShowSummary(), undefined)).toEqual([]);
		expect(watchProviderLink(decodeShowSummary(), undefined)).toBeUndefined();
	});

	it("reads the link recorded for the region and omits regions without one", () => {
		expect(watchProviderLink(decodeShowSummary(), "US")).toBe(
			"https://www.themoviedb.org/tv/1/watch?locale=US",
		);
		expect(watchProviderLink(decodeShowSummary(), "GB")).toBeUndefined();
		expect(watchProviderLink(decodeShowSummary(), "FR")).toBeUndefined();
	});

	it("adapts a provider logo to a remote locator and drops a missing one", () => {
		const [netflix, appleTv] = watchProviderGroups(decodeShowSummary(), "US").flatMap(
			(group) => group.providers,
		);
		assert(netflix !== undefined && appleTv !== undefined);

		expect(watchProviderAsset(netflix)).toEqual({
			type: "remote",
			url: "https://images.test/netflix.jpg",
		});
		expect(watchProviderAsset(appleTv)).toBeUndefined();
	});
});
