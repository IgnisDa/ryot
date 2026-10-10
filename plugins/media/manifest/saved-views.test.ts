import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { describe, expect, it } from "vitest";

import { mediaSavedViews } from "./saved-views";

const source = (name: string) => {
	const view = mediaSavedViews().find((candidate) => candidate.name === name);
	const query = view?.dataSources.queries["savedView"];
	if (query?.output.type !== "rows") {
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
			"column0",
			"column1",
			"column2",
			"populationStatus",
			"translationStatus",
			"ownerPluginId",
			"entitySchemaSlug",
			"id",
			"name",
			"schemaSlug",
			"state",
			"publishDate",
			"publishYear",
			"productionStatus",
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

	it("builds valid single-source documents for every media saved view", () => {
		for (const view of mediaSavedViews()) {
			expect(Object.keys(view.dataSources.queries)).toEqual(["savedView"]);
			expect(validateRyotQLDocument(view.dataSources, savedViewDataSourceAccess)).toBeNull();
		}
	});
});
