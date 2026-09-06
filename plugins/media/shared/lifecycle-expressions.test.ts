import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { describe, expect, it } from "vitest";

import { episodicLifecycleSnapshotRecipe } from "../backend/contracts/lifecycle-recipes";
import { podcastEpisodicKindConfig, showEpisodicKindConfig } from "./lifecycle-expressions";
import { podcastEpisodesRecipe, podcastRecipes } from "./podcast-recipes";
import { showRecipes, showSeasonEpisodesRecipe, showSeasonsRecipe } from "./show-recipes";

const ACTIVITY_INPUT = {
	timeZone: "UTC",
	coverageLimit: 50,
	watchDayLimit: 500,
	entityId: "parent-1",
	parentEventLimit: 60,
	episodeEventLimit: 100,
	collectionEventLimit: 40,
	episodeProgressLimit: 100,
};

// The real kernel validator enforces MAX_CORRELATED_DEPTH and duplicate aliases in scope; the
// next-up anchor with its display state is the deepest correlated chain these documents build.
describe("episodic lifecycle documents", () => {
	it.each([
		["show summary", showRecipes.summaryRecipe({ entityId: "show-1", collectionLimit: 5 })],
		["podcast summary", podcastRecipes.summaryRecipe({ entityId: "pod-1", collectionLimit: 5 })],
		["show presentation", showRecipes.presentationRecipe(["show-1"])],
		["podcast presentation", podcastRecipes.presentationRecipe(["pod-1"])],
		["show activity", showRecipes.activityRecipe(ACTIVITY_INPUT)],
		["podcast activity", podcastRecipes.activityRecipe(ACTIVITY_INPUT)],
		["show seasons", showSeasonsRecipe({ seasonLimit: 10, entityId: "show-1" })],
		["show season episodes", showSeasonEpisodesRecipe({ limit: 10, containerId: "season-1" })],
		["podcast episodes", podcastEpisodesRecipe({ limit: 10, containerId: "pod-1" })],
	])("validates the %s document", (_name, recipe) => {
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess)).toBeNull();
	});

	it.each([showEpisodicKindConfig, podcastEpisodicKindConfig])(
		"validates the $kind lifecycle snapshot for sandbox execution",
		(config) => {
			const recipe = episodicLifecycleSnapshotRecipe({ config, parentEntityId: "parent-1" });
			expect(validateRyotQLDocument(recipe.document, { type: "plugin" })).toBeNull();
		},
	);
});
