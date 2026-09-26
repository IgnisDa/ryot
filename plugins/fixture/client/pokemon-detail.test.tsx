import {
	disposePluginBridges,
	entityLocation,
	entityPageContext,
	mountPluginPage,
} from "@ryot-app/client-sdk/testing";
import { waitFor } from "@testing-library/dom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import PokemonDetailPage, { PokemonDetailBody } from "./pokemon-detail";
import { pokemonDetailRecipe } from "./pokemon-detail-query";

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 1, hasMore: false, nextCursor: null },
});

describe("Pokemon detail page", () => {
	afterEach(disposePluginBridges);

	it("queries the entity from the live same-document location", async () => {
		const page = mountPluginPage(PokemonDetailPage, {
			location: entityLocation("pokemon-1", "pokemon"),
			page: entityPageContext({
				pluginId: "fixture",
				entityId: "pokemon-1",
				entitySchemaSlug: "pokemon",
				exportName: "pokemon-detail",
			}),
		});
		await waitFor(() => expect(page.queryRequests("pokemon")).toHaveLength(1));

		page.navigate(entityLocation("pokemon-2", "pokemon"), { index: 1, key: "pokemon-2" });
		await waitFor(() => expect(page.queryRequests("pokemon")).toHaveLength(2));

		expect(
			page.queryRequests("pokemon").map((request) => request.document.queries.pokemon),
		).toEqual(
			["pokemon-1", "pokemon-2"].map((entityId) =>
				expect.objectContaining({
					where: expect.objectContaining({
						predicates: expect.arrayContaining([
							expect.objectContaining({ right: { type: "literal", value: entityId } }),
						]),
					}),
				}),
			),
		);
	});

	it("decodes fixture-owned Pokemon data", () => {
		const decoded = pokemonDetailRecipe({ entityId: "pokemon-1" }).decode({
			data: {
				requested: rows([{ schemaSlug: "pokemon" }]),
				pokemon: rows([
					{
						height: 7,
						weight: 69,
						id: "pokemon-1",
						pokedexNumber: 1,
						name: "Bulbasaur",
						baseExperience: 64,
						abilities: ["Overgrow"],
						types: ["Grass", "Poison"],
						sourceUrl: "https://pokeapi.co/api/v2/pokemon/bulbasaur",
						images: [{ type: "remote", url: "https://images.test/bulbasaur.png" }],
					},
				]),
			},
		});

		expect(decoded).toMatchObject({
			success: {
				entitySchemaSlug: "pokemon",
				pokemon: {
					pokedexNumber: 1,
					name: "Bulbasaur",
					types: ["Grass", "Poison"],
					images: [{ type: "remote", url: "https://images.test/bulbasaur.png" }],
				},
			},
		});
	});

	it("renders ready and unavailable branches without owning an application root", () => {
		const ready = renderToStaticMarkup(
			<PokemonDetailBody
				state={{
					status: "ready",
					data: {
						entitySchemaSlug: "pokemon",
						pokemon: {
							height: 7,
							weight: 69,
							images: null,
							id: "pokemon-1",
							sourceUrl: null,
							pokedexNumber: 1,
							name: "Bulbasaur",
							baseExperience: 64,
							abilities: ["Overgrow"],
							types: ["Grass", "Poison"],
						},
					},
				}}
			/>,
		);
		const missing = renderToStaticMarkup(
			<PokemonDetailBody
				state={{ status: "ready", data: { pokemon: null, entitySchemaSlug: null } }}
			/>,
		);

		expect(ready).toContain("Bulbasaur");
		expect(ready).toContain("Overgrow");
		expect(missing).toContain("This entity no longer exists.");
	});
});
