import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/client-sdk/effect";
import { createTestRyotClock } from "@ryot-app/client-sdk/testing";

import { loadMovePresentations } from "./move-presentation";
import { loadPokemonPresentations } from "./pokemon-presentation";

const reference = (entityId: string, entitySchemaSlug: string, name: string) => ({
	name,
	entityId,
	entitySchemaSlug,
	ownerPluginId: "fixture",
	populationStatus: "ready" as const,
	translationStatus: "ready" as const,
});

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

describe("fixture presentation loaders", () => {
	it.live("loads Pokemon through the shared singular-artwork source", () =>
		Effect.gen(function* () {
			const documents: unknown[] = [];
			const clock = createTestRyotClock({
				query: (document) => {
					documents.push(document);
					return Effect.succeed({
						data: {
							presentations: rows([
								{
									presentationHeight: 7,
									presentationWeight: 69,
									presentationId: "pokemon-1",
									presentationTypes: ["Grass"],
									presentationName: "Bulbasaur",
									presentationAbilities: ["Overgrow"],
									presentationArtwork: { type: "local", key: "pokemon/bulbasaur.png" },
								},
							]),
						},
					});
				},
			});
			const loaded = yield* loadPokemonPresentations({
				client: clock.client,
				references: [reference("pokemon-1", "pokemon", "Bulbasaur")],
			});

			expect(documents[0]).toMatchObject({
				queries: { presentations: { output: { type: "rows", pagination: { limit: 100 } } } },
			});
			expect(loaded["pokemon-1"]).toMatchObject({
				name: "Bulbasaur",
				artwork: { type: "local", key: "pokemon/bulbasaur.png" },
				batchAssets: [{ type: "local", key: "pokemon/bulbasaur.png" }],
			});
			yield* Effect.promise(() => clock.dispose());
		}),
	);

	it.live("loads moves through the shared move source", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock({
				query: () =>
					Effect.succeed({
						data: {
							presentations: rows([
								{
									presentationPower: 45,
									presentationId: "move-1",
									presentationType: "grass",
									presentationName: "Vine Whip",
									presentationDamageClass: "physical",
									presentationGeneration: "generation-i",
								},
							]),
						},
					}),
			});
			const loaded = yield* loadMovePresentations({
				client: clock.client,
				references: [reference("move-1", "move", "Vine Whip")],
			});

			expect(loaded["move-1"]).toEqual({
				power: 45,
				type: "grass",
				name: "Vine Whip",
				damageClass: "physical",
				generation: "generation-i",
			});
			yield* Effect.promise(() => clock.dispose());
		}),
	);
});
