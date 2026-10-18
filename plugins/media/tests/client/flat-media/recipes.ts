import { Schema } from "@ryot-app/plugin-kit/effect";
import { type Recipe, selectedField } from "@ryot-app/plugin-kit/ryotql";

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
			Schema.NullOr(Schema.Finite),
		),
	}),
});

export type UngroupedFixtureActivityEvent = UngroupedFixtureActivityResult["events"][number];

export type UngroupedFixtureActivityResult = Recipe.Success<
	typeof flatUngroupedFixtureRecipes.activityRecipe
>;
