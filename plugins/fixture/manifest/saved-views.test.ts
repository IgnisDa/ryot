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
			[],
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

	it("enables custom creation for the fixture-owned all-field-controls schema", () => {
		const view = fixtureSavedViews[2];
		const schema = fixturePlugin.entitySchemas[2];
		expect(view.slug).toBe("all-field-controls");
		expect(view.settings.subject.schemas).toEqual([{ slug: schema.slug, owner: { kind: "self" } }]);
		expect(view.settings.addAction).toEqual({
			type: "provider-search",
			schema: { slug: schema.slug, owner: { kind: "self" } },
			library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
		});
		expect(schema.editor).toEqual({ relationships: [] });
	});

	it("shows each public control value without projecting secret text", () => {
		const view = fixtureSavedViews[2];
		expect(view.settings.tableColumns.map(({ field }) => field)).toEqual([
			"image",
			"name",
			"text",
			"website",
			"email",
			"timezone",
			"decimal",
			"integer",
			"enabled",
			"date",
			"datetime",
			"choice",
			"choices",
			"tags",
			"details",
			"entries",
			"chipChoice",
			"assets",
		]);
		expect(view.dataSources.queries.savedView.output.fields).not.toContainEqual(
			objectContaining({ key: "secretText" }),
		);
		const image = view.dataSources.queries.savedView.output.fields.find(
			(selection) => "key" in selection && selection.key === "image",
		);
		expect(image).toMatchObject({
			expr: { type: "cast", target: "json", expr: { path: ["asset"], type: "jsonPath" } },
		});
	});
});
