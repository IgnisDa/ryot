import { describe, expect, it } from "vitest";

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
			const query = view.dataSources.queries.savedView;
			if (query?.output.type !== "rows") {
				throw new Error("Expected fixture saved-view rows query");
			}
			const fields = query.output.fields
				.flatMap((selection) => ("key" in selection ? [selection.key] : []))
				.filter((field) => field.startsWith("presentation"))
				.sort();
			expect(fields).toEqual(expected[index]);
		});
	});

	it("projects only the first Pokemon artwork locator", () => {
		const query = fixtureSavedViews[0].dataSources.queries.savedView;
		if (query?.output.type !== "rows") {
			throw new Error("Expected Pokemon saved-view rows query");
		}
		const artwork = query.output.fields.find(
			(selection) => "key" in selection && selection.key === "presentationArtwork",
		);
		expect(artwork).toMatchObject({
			expr: expect.objectContaining({ type: "jsonPath", path: ["images", 0] }),
		});
	});
});
