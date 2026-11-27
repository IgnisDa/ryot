import { describe, expect, it } from "bun:test";

import { stampRyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { bindDocument } from "@ryot-app/ryotql/binding";
import { savedViewDataSourceAccess, validateRyotQLDocument } from "@ryot-app/ryotql/validator";
import { Result } from "effect";

import { mediaSavedViews } from "./saved-views";

const source = (slug: string) => {
	const view = mediaSavedViews().find((candidate) => candidate.slug === slug);
	const query = view?.dataSources.queries["savedView"];
	if (!view || query?.output.type !== "rows") {
		throw new Error(`Expected ${slug} to have one saved-view rows source`);
	}
	return { view, output: query.output };
};

describe("media saved views", () => {
	it("selects the show table columns independently of card data", () => {
		const { output } = source("all-shows");

		expect(output.fields.map((selection) => ("key" in selection ? selection.key : null))).toEqual([
			"entityId",
			"image",
			"name",
			"publishYear",
			"productionStatus",
			"userRating",
			"ownerPluginId",
			"entitySchemaSlug",
		]);
		expect(
			output.fields.some((selection) => "key" in selection && selection.key === "images"),
		).toBe(false);
	});

	it("uses the group member artwork fallback in the shared image projection", () => {
		const { output } = source("all-movie-series");
		const image = output.fields.find(
			(selection) => "key" in selection && selection.key === "image",
		);

		expect(JSON.stringify(image)).toContain("movieGroupPresentationCoverMember");
		expect(JSON.stringify(image)).toContain('"purpose"');
	});
	it("builds valid browse and ranked-search documents for every media saved view", () => {
		for (const view of mediaSavedViews()) {
			expect(Object.keys(view.dataSources.queries)).toEqual(["savedView", "librarySearch"]);
			expect(
				validateRyotQLDocument(
					Result.getOrThrow(
						bindDocument(
							stampRyotQLDocument("media", view.dataSources),
							{ arguments: { search: "" } },
							{ reportingTimeZone: "UTC", now: new Date("2026-01-01T00:00:00Z") },
						),
					).document,
					savedViewDataSourceAccess,
				).error,
			).toBeNull();
		}
	});

	it("uses credit membership only for All People", () => {
		for (const view of mediaSavedViews()) {
			const dataSources = JSON.stringify(view.dataSources);
			if (view.slug === "all-people") {
				expect(dataSources).toContain('"value":"person-to-book"');
				expect(dataSources).toContain('"value":"person-to-music-group"');
			} else {
				expect(dataSources).not.toContain('"value":"person-to-book"');
			}
		}
	});

	it("orders titles by recent activity, creators by credits and groups by parts", () => {
		const order = (slug: string) => JSON.stringify(source(slug).view.dataSources);
		expect(order("all-movies")).toContain('"path":["lastActivityAt"]');
		expect(order("all-people")).toContain('"function":"countDistinct"');
		expect(order("all-book-series")).toContain('"path":["parts"]');
		expect(source("all-movies").view.settings).not.toHaveProperty("filterFields");
	});
});
