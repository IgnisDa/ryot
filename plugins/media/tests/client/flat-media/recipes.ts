import { Schema } from "@ryot-app/plugin-kit/effect";
import { type Recipe, selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber } from "../../../shared/entity-selections";
import {
	mediaFlatRecipes,
	mediaUnlinkedCreatorsOverviewQueries,
} from "../../../shared/media-recipes";

export const flatFixtureRecipes = mediaFlatRecipes({
	slug: "fixture",
	alias: "fixture",
	summaryFields: () => ({}),
	groupSlug: "fixture-group",
	consumptionUnit: "minutes",
	presentationFields: () => ({}),
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
});

export const flatUngroupedFixtureRecipes = mediaFlatRecipes({
	slug: "ungrouped",
	alias: "ungrouped",
	summaryFields: () => ({}),
	consumptionUnit: "minutes",
	presentationFields: () => ({}),
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
