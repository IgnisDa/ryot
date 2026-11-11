import { describe, expect, it } from "bun:test";

import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { bindDocument } from "@ryot-app/ryotql/binding";
import { Result } from "effect";

import { mediaSavedViews } from "./saved-views";

const source = (name: string) => {
	const view = mediaSavedViews().find((candidate) => candidate.name === name);
	const query = view?.dataSources.queries["savedView"];
	if (!view || query?.output.type !== "rows") {
		throw new Error(`Expected ${name} to have one saved-view rows source`);
	}
	return { view, output: query.output };
};

describe("media saved views", () => {
	it("keeps table projections first and appends the show presentation fields", () => {
		const { output } = source("All Shows");

		expect(output.fields.map((selection) => ("key" in selection ? selection.key : null))).toEqual([
			"entityId",
			"image",
			"name",
			"publishYear",
			"productionStatus",
			"userRating",
			"ownerPluginId",
			"entitySchemaSlug",
			"id",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"relatedPopulationStatus",
			"state",
			"publishDate",
			"airedEpisodes",
			"watchedEpisodes",
			"upcomingEpisodes",
			"inProgressEpisodes",
			"storedSeasons",
		]);
		expect(
			output.fields.some((selection) => "key" in selection && selection.key === "images"),
		).toBe(false);
	});

	it("uses the group member artwork fallback in the shared image projection", () => {
		const { output } = source("All Movie Series");
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
							view.dataSources,
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
			if (view.name === "All People") {
				expect(dataSources).toContain('"value":"person-to-book"');
				expect(dataSources).toContain('"value":"person-to-music-group"');
			} else {
				expect(dataSources).not.toContain('"value":"person-to-book"');
			}
		}
	});

	it("orders titles by recent activity, creators by credits and groups by parts", () => {
		const order = (name: string) => JSON.stringify(source(name).view.dataSources);
		expect(order("All Movies")).toContain('"path":["lastActivityAt"]');
		expect(order("All People")).toContain('"function":"countDistinct"');
		expect(order("All Book Series")).toContain('"path":["parts"]');
		expect(source("All Movies").view.settings).not.toHaveProperty("filterFields");
	});
});
