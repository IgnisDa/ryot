import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField, type Recipe } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber } from "../../../shared/entity-selections";
import {
	mediaFlatRecipes,
	mediaTimeSpentMeasure,
	mediaUnlinkedCreatorsOverviewQueries,
} from "../../../shared/media-recipes";

export const flatFixtureRecipes = mediaFlatRecipes({
	slug: "fixture",
	alias: "fixture",
	summaryFields: () => ({}),
	groupSlug: "fixture-group",
	presentationFields: () => ({}),
	measure: mediaTimeSpentMeasure(),
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
});

export const flatUngroupedFixtureRecipes = mediaFlatRecipes({
	slug: "ungrouped",
	alias: "ungrouped",
	summaryFields: () => ({}),
	presentationFields: () => ({}),
	measure: mediaTimeSpentMeasure(),
	activityEventFields: (event) => ({
		fixtureChapter: selectedField(
			propertyNumber(event, "fixtureChapter"),
			Schema.NullOr(Schema.Number),
		),
	}),
});

export type UngroupedFixtureActivityResult = Recipe.Success<
	typeof flatUngroupedFixtureRecipes.activityRecipe
>;

export type UngroupedFixtureActivityEvent = UngroupedFixtureActivityResult["events"][number];
