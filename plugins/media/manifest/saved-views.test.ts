import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { describe, expect, it } from "vitest";

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
			"ownerPluginId",
			"entitySchemaSlug",
			"genresValue",
			"publishYearValue",
			"providerRatingValue",
			"isNsfwValue",
			"id",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
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

	it("builds valid single-source documents for every media saved view", () => {
		for (const view of mediaSavedViews()) {
			expect(Object.keys(view.dataSources.queries)).toEqual(["savedView"]);
			expect(validateRyotQLDocument(view.dataSources, savedViewDataSourceAccess)).toBeNull();
		}
	});

	it("declares base-field filters on media views over raw-value projections", () => {
		const { view, output } = source("All Books");
		expect(view.settings.filterFields).toEqual([
			{ key: "genres", kind: "value", label: "Genres", type: "text-list", field: "genresValue" },
			{
				kind: "value",
				type: "number",
				key: "publishYear",
				label: "Publish year",
				field: "publishYearValue",
			},
			{
				kind: "value",
				type: "number",
				key: "providerRating",
				label: "Provider rating",
				field: "providerRatingValue",
			},
			{
				key: "isNsfw",
				kind: "value",
				type: "boolean",
				field: "isNsfwValue",
				label: "Adult content",
			},
		]);
		const keys = output.fields.flatMap((selection) => ("key" in selection ? [selection.key] : []));
		expect(keys).toEqual(
			expect.arrayContaining([
				"genresValue",
				"publishYearValue",
				"providerRatingValue",
				"isNsfwValue",
			]),
		);
		const genres = output.fields.find(
			(selection) => "key" in selection && selection.key === "genresValue",
		);
		expect(genres).toMatchObject({ expr: { type: "jsonPath", path: ["genres"] } });
	});

	it("leaves persons and companies with only the kernel Collections filter", () => {
		expect(source("All Persons").view.settings).not.toHaveProperty("filterFields");
		expect(source("All Companies").view.settings).not.toHaveProperty("filterFields");
	});
});
