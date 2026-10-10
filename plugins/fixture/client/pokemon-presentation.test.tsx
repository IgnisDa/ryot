import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "@ryot-app/client-sdk/effect";
import {
	disposePluginBridges,
	entityLocation,
	entityPageContext,
	mountPluginPage,
} from "@ryot-app/client-sdk/testing";
import { fireEvent, waitFor } from "@testing-library/dom";
import { useState } from "react";

import {
	PokemonCard,
	PokemonRow,
	preparePokemonPresentations,
	type PokemonPresentationViewData,
} from "./pokemon-presentation";

const bulbasaur: PokemonPresentationViewData = {
	height: 7,
	weight: 69,
	name: "Bulbasaur",
	types: ["Grass", "Poison"],
	abilities: ["Overgrow", "Chlorophyll"],
	artwork: { type: "local", key: "pokemon/bulbasaur.png" },
	batchAssets: [{ type: "local", key: "pokemon/bulbasaur.png" }],
};

const missingno: PokemonPresentationViewData = {
	types: null,
	height: null,
	weight: null,
	artwork: null,
	abilities: null,
	batchAssets: [],
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

const presentationSource = (
	id: string,
	name: string,
	artwork: PokemonPresentationViewData["artwork"],
) => ({
	presentationId: id,
	presentationHeight: 7,
	presentationName: name,
	presentationWeight: 69,
	presentationTypes: ["Grass"],
	presentationArtwork: artwork,
	presentationAbilities: ["Overgrow"],
});

const ExpansionPage = () => (
	<div>
		<PokemonCard
			data={bulbasaur}
			viewContext={{}}
			reference={reference("pokemon-1", "Bulbasaur")}
		/>
		<PokemonRow data={missingno} viewContext={{}} reference={reference("pokemon-2", "MissingNo")} />
	</div>
);

const ReplacementPage = () => {
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

describe("Pokemon presentations", () => {
	afterEach(disposePluginBridges);

	it("prepares saved-view rows and shares one deduplicated managed-artwork list", () => {
		const references = [
			reference("pokemon-1", "Bulbasaur"),
			reference("pokemon-2", "Ivysaur"),
			reference("pokemon-3", "Venusaur"),
			reference("pokemon-4", "Charmander"),
		];
		const prepared = Result.getOrThrow(
			preparePokemonPresentations({
				references,
				sources: new Map([
					[
						"pokemon-1",
						presentationSource("pokemon-1", "Bulbasaur", {
							type: "local",
							key: "pokemon/shared.png",
						}),
					],
					[
						"pokemon-2",
						presentationSource("pokemon-2", "Ivysaur", {
							type: "local",
							key: "pokemon/shared.png",
						}),
					],
					[
						"pokemon-3",
						presentationSource("pokemon-3", "Venusaur", {
							type: "s3",
							key: "pokemon/venusaur.png",
						}),
					],
					[
						"pokemon-4",
						presentationSource("pokemon-4", "Charmander", {
							type: "remote",
							url: "https://images.test/charmander.png",
						}),
					],
				]),
			}),
		);

		expect(Object.keys(prepared).sort()).toEqual([
			"pokemon-1",
			"pokemon-2",
			"pokemon-3",
			"pokemon-4",
		]);
		expect(prepared["pokemon-1"]?.batchAssets).toEqual([
			{ type: "local", key: "pokemon/shared.png" },
			{ type: "s3", key: "pokemon/venusaur.png" },
		]);
		for (const pokemon of Object.values(prepared)) {
			expect(pokemon.batchAssets).toBe(prepared["pokemon-1"]?.batchAssets);
		}
	});

	it("fails preparation when a saved-view row is missing", () => {
		expect(
			Result.isFailure(
				preparePokemonPresentations({
					sources: new Map(),
					references: [reference("pokemon-1", "Bulbasaur")],
				}),
			),
		).toBe(true);
	});

	it.live("renders artwork and keeps expansion local to each entity item", () =>
		Effect.gen(function* () {
			const page = mountPluginPage(ExpansionPage, {
				location: entityLocation("pokemon-1", "pokemon"),
				page: entityPageContext({
					pluginId: "fixture",
					entityId: "pokemon-1",
					exportName: "pokemon-card",
					entitySchemaSlug: "pokemon",
				}),
			});

			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.querySelectorAll("button")).toHaveLength(2)),
			);
			yield* Effect.promise(() => waitFor(() => expect(page.assetRequests()).toHaveLength(1)));
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
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.container?.querySelector("img")?.getAttribute("src")).toBe(
						"https://images.test/bulbasaur.png",
					),
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
			yield* Effect.promise(() =>
				waitFor(() => expect(rowButton.getAttribute("aria-expanded")).toBe("true")),
			);
			expect(cardButton?.getAttribute("aria-expanded")).toBe("false");
			expect(page.container?.textContent).toContain("Unavailable");
			expect(
				page.container?.querySelector('[data-layout="row"] [aria-hidden="true"]'),
			).not.toBeNull();

			page.navigate(entityLocation("pokemon-1", "pokemon"), { compact: true });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						page.container?.querySelector('[data-layout="row"]')?.getAttribute("data-compact"),
					).toBe("true"),
				),
			);
			expect(rowButton.getAttribute("aria-expanded")).toBe("true");
		}),
	);

	it.live("keeps details expanded when replacement data has the same entity identity", () =>
		Effect.gen(function* () {
			const page = mountPluginPage(ReplacementPage, {
				location: entityLocation("pokemon-1", "pokemon"),
				page: entityPageContext({
					pluginId: "fixture",
					entityId: "pokemon-1",
					exportName: "pokemon-row",
					entitySchemaSlug: "pokemon",
				}),
			});

			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.querySelectorAll("button")).toHaveLength(2)),
			);
			const buttons = page.container?.querySelectorAll("button");
			const replaceButton = buttons?.item(0);
			const detailsButton = buttons?.item(1);
			if (!replaceButton || !detailsButton) {
				throw new Error("Pokemon replacement controls were not rendered");
			}
			fireEvent.click(detailsButton);
			yield* Effect.promise(() =>
				waitFor(() => expect(detailsButton.getAttribute("aria-expanded")).toBe("true")),
			);

			fireEvent.click(replaceButton);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Bulbasaur updated")),
			);
			expect(
				page.container?.querySelector('[data-layout="row"] button')?.getAttribute("aria-expanded"),
			).toBe("true");
			expect(page.container?.textContent).toContain("Overgrow");
		}),
	);
});
