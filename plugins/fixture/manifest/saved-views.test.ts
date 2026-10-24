import { objectContaining } from "@ryot-app/testing/matchers";
import { describe, expect, it } from "vitest";

import { fixturePlugin } from "./plugin";
import { fixtureSavedViews } from "./saved-views";

describe("fixture saved-view presentations", () => {
	it("selects Pokemon and move card data in each entity-browser row", () => {
		const expected = [
			[
				"presentationAbilities",
				"presentationArtwork",
				"presentationHeight",
				"presentationId",
				"presentationName",
				"presentationTypes",
				"presentationWeight",
			],
			[
				"presentationDamageClass",
				"presentationGeneration",
				"presentationId",
				"presentationName",
				"presentationPower",
				"presentationType",
			],
		];
		fixtureSavedViews.forEach((view, index) => {
			const fields = view.dataSources.queries.savedView.output.fields
				.flatMap((selection) => ("key" in selection ? [selection.key] : []))
				.filter((field) => field.startsWith("presentation"))
				.sort();
			expect(fields).toEqual(expected[index]);
		});
	});

	it("projects only the first Pokemon artwork locator", () => {
		const artwork = fixtureSavedViews[0].dataSources.queries.savedView.output.fields.find(
			(selection) => "key" in selection && selection.key === "presentationArtwork",
		);
		expect(artwork).toMatchObject({
			expr: objectContaining({ type: "jsonPath", path: ["images", 0] }),
		});
	});

	it("declares the Pokemon height filter on its entity schema instead of the view", () => {
		const [pokemon] = fixturePlugin.entitySchemas;
		expect(pokemon.browse.fields.map(({ key }) => key)).toEqual(["height"]);
		expect(fixtureSavedViews[0].settings).not.toHaveProperty("filterFields");
	});
});
