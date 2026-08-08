import {
	createTestRyotClock,
	disposePluginBridges,
	entityLocation,
	entityPageContext,
	mountPluginPage,
} from "@ryot-app/client-sdk/testing";
import { fireEvent, waitFor } from "@testing-library/dom";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
	loadPokemonPresentations,
	PokemonCard,
	PokemonRow,
	type PokemonPresentationViewData,
} from "./pokemon-presentation";
import { pokemonPresentationRecipe } from "./pokemon-presentation-query";

const bulbasaur: PokemonPresentationViewData = {
	height: 7,
	weight: 69,
	id: "pokemon-1",
	name: "Bulbasaur",
	types: ["Grass", "Poison"],
	abilities: ["Overgrow", "Chlorophyll"],
	artwork: [{ type: "local", key: "pokemon/bulbasaur.png" }],
	batchAssets: [{ type: "local", key: "pokemon/bulbasaur.png" }],
};

const missingno: PokemonPresentationViewData = {
	types: null,
	height: null,
	weight: null,
	artwork: null,
	abilities: null,
	batchAssets: [],
	id: "pokemon-2",
	name: "MissingNo",
};

const reference = (entityId: string, name: string) => ({
	name,
	entityId,
	ownerPluginId: "fixture",
	entitySchemaSlug: "pokemon",
	populationStatus: "ready" as const,
	translationStatus: "ready" as const,
});

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

describe("Pokemon presentations", () => {
	afterEach(disposePluginBridges);

	it("loads Pokemon once and shares one deduplicated managed-artwork list", async () => {
		const documents: unknown[] = [];
		const clock = createTestRyotClock({
			query: (document) => {
				documents.push(document);
				return Promise.resolve({
					data: {
						pokemon: rows([
							{ ...bulbasaur, artwork: [{ type: "local", key: "pokemon/shared.png" }] },
							{
								...bulbasaur,
								id: "pokemon-2",
								name: "Ivysaur",
								artwork: [{ type: "local", key: "pokemon/shared.png" }],
							},
							{
								...bulbasaur,
								id: "pokemon-3",
								name: "Venusaur",
								artwork: [{ type: "s3", key: "pokemon/venusaur.png" }],
							},
							{
								...bulbasaur,
								id: "pokemon-4",
								name: "Charmander",
								artwork: [{ type: "remote", url: "https://images.test/charmander.png" }],
							},
						]),
					},
				});
			},
		});
		const loaded = await loadPokemonPresentations({
			client: clock.client,
			signal: new AbortController().signal,
			references: [
				reference("pokemon-4", "Charmander"),
				reference("pokemon-1", "Bulbasaur"),
				reference("pokemon-2", "Ivysaur"),
				reference("pokemon-3", "Venusaur"),
				reference("pokemon-1", "Bulbasaur"),
			],
		});

		expect(documents).toHaveLength(1);
		expect(Object.keys(loaded).sort()).toEqual([
			"pokemon-1",
			"pokemon-2",
			"pokemon-3",
			"pokemon-4",
		]);
		expect(loaded["pokemon-1"]?.batchAssets).toEqual([
			{ type: "local", key: "pokemon/shared.png" },
			{ type: "s3", key: "pokemon/venusaur.png" },
		]);
		for (const pokemon of Object.values(loaded)) {
			expect(pokemon.batchAssets).toBe(loaded["pokemon-1"]?.batchAssets);
		}
		await clock.dispose();
	});

	it("selects all presentation fields in one deterministic batch query", () => {
		const recipe = pokemonPresentationRecipe(["pokemon-2", "pokemon-1"]);
		expect(Object.keys(recipe.document.queries)).toEqual(["pokemon"]);
		const pokemon = recipe.document.queries.pokemon;
		if (pokemon?.output.type !== "rows") {
			throw new Error("Pokemon presentation did not produce rows");
		}
		expect(
			pokemon.output.fields
				.map((field) => ("key" in field ? field.key : null))
				.sort((left, right) => String(left).localeCompare(String(right))),
		).toEqual(["abilities", "artwork", "height", "id", "name", "types", "weight"]);

		const decoded = recipe.decode({
			data: {
				pokemon: rows([
					{
						height: 7,
						weight: 69,
						id: "pokemon-1",
						name: "Bulbasaur",
						abilities: ["Overgrow"],
						types: ["Grass", "Poison"],
						artwork: [{ type: "local", key: "pokemon/bulbasaur.png" }],
					},
				]),
			},
		});
		expect(decoded).toMatchObject({
			success: [
				{
					height: 7,
					weight: 69,
					abilities: ["Overgrow"],
					artwork: [{ type: "local", key: "pokemon/bulbasaur.png" }],
				},
			],
		});
	});

	it("renders artwork and keeps expansion local to each entity item", async () => {
		const Page = () => (
			<div>
				<PokemonCard
					data={bulbasaur}
					viewContext={{}}
					reference={reference("pokemon-1", "Bulbasaur")}
				/>
				<PokemonRow
					data={missingno}
					viewContext={{}}
					reference={reference("pokemon-2", "MissingNo")}
				/>
			</div>
		);
		const page = mountPluginPage(Page, {
			location: entityLocation("pokemon-1", "pokemon"),
			page: entityPageContext({
				pluginId: "fixture",
				entityId: "pokemon-1",
				exportName: "pokemon-card",
				entitySchemaSlug: "pokemon",
			}),
		});

		await waitFor(() => expect(page.container?.querySelectorAll("button")).toHaveLength(2));
		await waitFor(() => expect(page.assetRequests()).toHaveLength(1));
		const assetRequest = page.assetRequests()[0];
		if (!assetRequest) {
			throw new Error("Pokemon artwork resolution was not requested");
		}
		expect(assetRequest.assets).toEqual([{ type: "local", key: "pokemon/bulbasaur.png" }]);
		page.replyAssets(assetRequest.requestId, {
			outcome: "success",
			resolutions: [
				{
					expiresAt: "2099-01-01T00:00:00.000Z",
					url: "https://images.test/bulbasaur.png",
					asset: { type: "local", key: "pokemon/bulbasaur.png" },
				},
			],
		});
		await waitFor(() =>
			expect(page.container?.querySelector("img")?.getAttribute("src")).toBe(
				"https://images.test/bulbasaur.png",
			),
		);
		const buttons = page.container?.querySelectorAll("button");
		const cardButton = buttons?.item(0);
		const rowButton = buttons?.item(1);
		if (!rowButton) {
			throw new Error("Pokemon row expansion control was not rendered");
		}
		expect(cardButton?.getAttribute("aria-expanded")).toBe("false");
		expect(rowButton.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(rowButton);
		await waitFor(() => expect(rowButton.getAttribute("aria-expanded")).toBe("true"));
		expect(cardButton?.getAttribute("aria-expanded")).toBe("false");
		expect(page.container?.textContent).toContain("Unavailable");
		expect(
			page.container?.querySelector('[data-layout="row"] [aria-hidden="true"]'),
		).not.toBeNull();

		page.navigate(entityLocation("pokemon-1", "pokemon"), { compact: true });
		await waitFor(() =>
			expect(
				page.container?.querySelector('[data-layout="row"]')?.getAttribute("data-compact"),
			).toBe("true"),
		);
		expect(rowButton.getAttribute("aria-expanded")).toBe("true");
	});

	it("keeps details expanded when replacement data has the same entity identity", async () => {
		const Page = () => {
			const [data, setData] = useState(bulbasaur);
			return (
				<div>
					<button type="button" onClick={() => setData({ ...data, name: "Bulbasaur updated" })}>
						Replace data
					</button>
					<PokemonRow data={data} viewContext={{}} reference={reference("pokemon-1", data.name)} />
				</div>
			);
		};
		const page = mountPluginPage(Page, {
			location: entityLocation("pokemon-1", "pokemon"),
			page: entityPageContext({
				pluginId: "fixture",
				entityId: "pokemon-1",
				exportName: "pokemon-row",
				entitySchemaSlug: "pokemon",
			}),
		});

		await waitFor(() => expect(page.container?.querySelectorAll("button")).toHaveLength(2));
		const buttons = page.container?.querySelectorAll("button");
		const replaceButton = buttons?.item(0);
		const detailsButton = buttons?.item(1);
		if (!replaceButton || !detailsButton) {
			throw new Error("Pokemon replacement controls were not rendered");
		}
		fireEvent.click(detailsButton);
		await waitFor(() => expect(detailsButton.getAttribute("aria-expanded")).toBe("true"));

		fireEvent.click(replaceButton);
		await waitFor(() => expect(page.container?.textContent).toContain("Bulbasaur updated"));
		expect(
			page.container?.querySelector('[data-layout="row"] button')?.getAttribute("aria-expanded"),
		).toBe("true");
		expect(page.container?.textContent).toContain("Overgrow");
	});
});
