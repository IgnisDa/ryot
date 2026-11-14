import { expect, it } from "bun:test";

import { Result } from "@ryot-app/plugin-client-sdk/effect";

import { prepareMovePresentations } from "./move-presentation";
import { preparePokemonPresentations } from "./pokemon-presentation";

const reference = (entityId: string, entitySchemaSlug: string) => ({
	entityId,
	name: entityId,
	entitySchemaSlug,
	ownerPluginId: "fixture",
	populationStatus: { state: "succeeded", availability: "complete" } as const,
	translationStatus: { state: "succeeded", availability: "complete" } as const,
});

it("prepares Pokemon artwork from captured data without a query client", () => {
	const result = Result.getOrThrow(
		preparePokemonPresentations({
			references: [reference("one", "pokemon")],
			sources: new Map([
				[
					"one",
					{
						presentationId: "one",
						presentationHeight: 7,
						presentationWeight: 69,
						presentationTypes: ["Grass"],
						presentationName: "Bulbasaur",
						presentationAbilities: ["Overgrow"],
						presentationArtwork: { type: "local", key: "pokemon/bulbasaur.png" },
					},
				],
			]),
		}),
	);
	expect(result["one"]).toMatchObject({
		name: "Bulbasaur",
		artwork: { type: "local", key: "pokemon/bulbasaur.png" },
		batchAssets: [{ type: "local", key: "pokemon/bulbasaur.png" }],
	});
});
it("prepares moves and rejects incomplete captured data", () => {
	const references = [reference("one", "move")];
	const result = Result.getOrThrow(
		prepareMovePresentations({
			references,
			sources: new Map([
				[
					"one",
					{
						presentationId: "one",
						presentationPower: 45,
						presentationType: "grass",
						presentationName: "Vine Whip",
						presentationDamageClass: "physical",
						presentationGeneration: "generation-i",
					},
				],
			]),
		}),
	);
	expect(result["one"]).toEqual({
		power: 45,
		type: "grass",
		name: "Vine Whip",
		damageClass: "physical",
		generation: "generation-i",
	});
	expect(Result.isFailure(prepareMovePresentations({ references, sources: new Map() }))).toBe(true);
});
