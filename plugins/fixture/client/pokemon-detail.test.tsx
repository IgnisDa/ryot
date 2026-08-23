import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const livePage = vi.hoisted(() => ({
	queriedEntityIds: [] as string[],
	location: { kind: "entity" as const, entityId: "pokemon-1", entitySchemaSlug: "pokemon" },
}));

vi.mock("@ryot-app/client-sdk/plugin", () => ({
	usePluginLocation: () => livePage.location,
}));
vi.mock("@ryot-app/client-sdk/react", async (importOriginal) => ({
	...(await importOriginal()),
	useRyotQuery: (_query: unknown, input: { readonly entityId: string }) => {
		livePage.queriedEntityIds.push(input.entityId);
		return { status: "loading" };
	},
}));
vi.mock("@ryot-app/client-sdk/screen", () => ({
	PluginScreenFrame: ({ children }: { readonly children: React.ReactNode }) => children,
}));

import PokemonDetailPage, { PokemonDetailBody } from "./pokemon-detail";
import { pokemonDetailRecipe } from "./pokemon-detail-query";

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows",
	pageInfo: { hasMore: false, limit: 1, nextCursor: null },
});

describe("Pokemon detail page", () => {
	it("queries the entity from the live same-document location", () => {
		livePage.queriedEntityIds.length = 0;
		renderToStaticMarkup(<PokemonDetailPage />);
		livePage.location = { ...livePage.location, entityId: "pokemon-2" };
		renderToStaticMarkup(<PokemonDetailPage />);

		expect(livePage.queriedEntityIds).toEqual(["pokemon-1", "pokemon-2"]);
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
