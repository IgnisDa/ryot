import { describe, expect, it } from "bun:test";

import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { podcastEpisodesRecipe, podcastRecipes } from "./podcast-recipes";
import { showRecipes, showSeasonEpisodesRecipe, showSeasonsRecipe } from "./show-recipes";

const ACTIVITY_INPUT = {
	coverageLimit: 50,
	watchDayLimit: 500,
	entityId: "parent-1",
	parentEventLimit: 60,
	episodeEventLimit: 100,
	collectionEventLimit: 40,
	episodeProgressLimit: 100,
	timeZone: TimeZone.make("UTC"),
};

describe("episodic lifecycle documents", () => {
	it.each([
		[
			"show summary",
			bindRecipe(showRecipes.summaryRecipe({ reference: { kind: "self" } }), {
				entityId: "show-1",
			}),
		],
		[
			"podcast summary",
			bindRecipe(podcastRecipes.summaryRecipe({ reference: { kind: "self" } }), {
				entityId: "pod-1",
			}),
		],
		[
			"show activity",
			bindRecipe(showRecipes.activityRecipe({ reference: { kind: "self" } }), {
				entityId: { ...ACTIVITY_INPUT, reference: { kind: "self" } }.entityId,
			}),
		],
		[
			"podcast activity",
			bindRecipe(podcastRecipes.activityRecipe({ reference: { kind: "self" } }), {
				entityId: { ...ACTIVITY_INPUT, reference: { kind: "self" } }.entityId,
			}),
		],
		[
			"show seasons",
			bindRecipe(showSeasonsRecipe({ reference: { kind: "self" } }), { entityId: "show-1" }),
		],
		[
			"show season episodes",
			bindRecipe(showSeasonEpisodesRecipe({ reference: { kind: "self" } }), {
				limit: 10,
				containerId: "season-1",
			}),
		],
		[
			"podcast episodes",
			bindRecipe(podcastEpisodesRecipe({ reference: { kind: "self" } }), {
				limit: 10,
				containerId: "pod-1",
			}),
		],
	])("validates the %s document", (_name, recipe) => {
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess).error).toBeNull();
	});
});
