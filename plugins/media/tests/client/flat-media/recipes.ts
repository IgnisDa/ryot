import { Schema } from "@ryot-app/plugin-kit/effect";
import { isNull, selectedField, type Recipe } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber, type Table } from "../../../shared/entity-selections";
import { mediaFlatRecipes } from "../../../shared/media-recipes";

const fixtureMeasure = (event: Table) => ({
	amount: propertyNumber(event, "timeSpent"),
	isUnknown: isNull(propertyNumber(event, "timeSpent")),
});

export const flatFixtureRecipes = mediaFlatRecipes({
	slug: "fixture",
	alias: "fixture",
	measure: fixtureMeasure,
	summaryFields: () => ({}),
	groupSlug: "fixture-group",
	presentationFields: () => ({}),
});

export const flatUngroupedFixtureRecipes = mediaFlatRecipes({
	slug: "ungrouped",
	alias: "ungrouped",
	measure: fixtureMeasure,
	summaryFields: () => ({}),
	presentationFields: () => ({}),
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
